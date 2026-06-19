import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Configuración: se toma de variables de entorno (las vas a setear en Railway)
// ---------------------------------------------------------------------------
const ACCESS_TOKEN = process.env.TIENDANUBE_ACCESS_TOKEN;
const STORE_ID = process.env.TIENDANUBE_USER_ID;
const USER_AGENT = process.env.TIENDANUBE_USER_AGENT || "Cowork Integration (tu-email@ejemplo.com)";
const API_BASE = `https://api.tiendanube.com/v1/${STORE_ID}`;

if (!ACCESS_TOKEN || !STORE_ID) {
  console.error("Faltan TIENDANUBE_ACCESS_TOKEN o TIENDANUBE_USER_ID en las variables de entorno.");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Helper para llamar a la API de Tiendanube
// ---------------------------------------------------------------------------
async function tiendanubeFetch(path, params = {}) {
  const url = new URL(`${API_BASE}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  const res = await fetch(url, {
    headers: {
      Authentication: `bearer ${ACCESS_TOKEN}`,
      "User-Agent": USER_AGENT,
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Tiendanube API error ${res.status}: ${body}`);
  }

  return res.json();
}

function asToolResult(data) {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  };
}

// ---------------------------------------------------------------------------
// Definición del servidor MCP y sus herramientas (todas de solo lectura)
// ---------------------------------------------------------------------------
function buildServer() {
  const server = new McpServer({
    name: "tiendanube-mcp-simple",
    version: "1.0.0",
  });

  server.tool(
    "get_store_info",
    "Obtiene información general de la tienda (nombre, dominio, configuración básica)",
    {},
    async () => asToolResult(await tiendanubeFetch("/store"))
  );

  server.tool(
    "list_products",
    "Lista productos de la tienda. Permite buscar por texto y paginar.",
    {
      q: z.string().optional().describe("Texto de búsqueda (nombre del producto)"),
      page: z.number().int().min(1).optional().describe("Número de página (default 1)"),
      per_page: z.number().int().min(1).max(200).optional().describe("Resultados por página (default 50, max 200)"),
    },
    async ({ q, page, per_page }) =>
      asToolResult(await tiendanubeFetch("/products", { q, page, per_page: per_page ?? 50 }))
  );

  server.tool(
    "get_product",
    "Obtiene el detalle de un producto por su ID, incluyendo variantes y stock",
    { product_id: z.number().int().describe("ID del producto en Tiendanube") },
    async ({ product_id }) => asToolResult(await tiendanubeFetch(`/products/${product_id}`))
  );

  server.tool(
    "list_orders",
    "Lista pedidos de la tienda. Permite filtrar por estado y paginar.",
    {
      status: z
        .enum(["open", "closed", "cancelled", "any"])
        .optional()
        .describe("Estado del pedido (default: any)"),
      page: z.number().int().min(1).optional().describe("Número de página (default 1)"),
      per_page: z.number().int().min(1).max(200).optional().describe("Resultados por página (default 50, max 200)"),
    },
    async ({ status, page, per_page }) =>
      asToolResult(await tiendanubeFetch("/orders", { status, page, per_page: per_page ?? 50 }))
  );

  server.tool(
    "get_order",
    "Obtiene el detalle completo de un pedido por su ID (productos, cliente, totales, envío)",
    { order_id: z.number().int().describe("ID del pedido en Tiendanube") },
    async ({ order_id }) => asToolResult(await tiendanubeFetch(`/orders/${order_id}`))
  );

  server.tool(
    "list_customers",
    "Lista clientes de la tienda. Permite buscar por texto y paginar.",
    {
      q: z.string().optional().describe("Texto de búsqueda (nombre o email del cliente)"),
      page: z.number().int().min(1).optional().describe("Número de página (default 1)"),
      per_page: z.number().int().min(1).max(200).optional().describe("Resultados por página (default 50, max 200)"),
    },
    async ({ q, page, per_page }) =>
      asToolResult(await tiendanubeFetch("/customers", { q, page, per_page: per_page ?? 50 }))
  );

  server.tool(
    "get_customer",
    "Obtiene el detalle de un cliente por su ID, incluyendo direcciones y pedidos asociados",
    { customer_id: z.number().int().describe("ID del cliente en Tiendanube") },
    async ({ customer_id }) => asToolResult(await tiendanubeFetch(`/customers/${customer_id}`))
  );

  server.tool(
    "list_categories",
    "Lista las categorías de productos de la tienda",
    {
      page: z.number().int().min(1).optional().describe("Número de página (default 1)"),
      per_page: z.number().int().min(1).max(200).optional().describe("Resultados por página (default 50, max 200)"),
    },
    async ({ page, per_page }) => asToolResult(await tiendanubeFetch("/categories", { page, per_page: per_page ?? 50 }))
  );

  return server;
}

// ---------------------------------------------------------------------------
// Endpoints de cumplimiento de privacidad (requeridos por Tiendanube)
// Responden 200 OK; no almacenamos datos de clientes en este servidor.
// ---------------------------------------------------------------------------
const app = express();
app.use(express.json());

app.post("/webhooks/store-redact", (req, res) => res.sendStatus(200));
app.post("/webhooks/customer-redact", (req, res) => res.sendStatus(200));
app.post("/webhooks/customer-data-request", (req, res) => res.sendStatus(200));

// Health check simple, útil para Railway
app.get("/", (req, res) => res.send("Tiendanube MCP server OK"));

// ---------------------------------------------------------------------------
// Endpoint MCP (modo stateless: una transport nueva por request)
// ---------------------------------------------------------------------------
app.post("/mcp", async (req, res) => {
  try {
    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    res.on("close", () => {
      transport.close();
      server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("Error manejando request MCP:", err);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
});

// En modo stateless no usamos sesiones, así que GET/DELETE no aplican,
// pero respondemos explícitamente (en vez de dejar que Express tire 404)
// porque algunos clientes MCP los prueban antes de usar POST.
app.get("/mcp", (req, res) => {
  res.status(405).json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed. This server only supports POST for /mcp." },
    id: null,
  });
});
app.delete("/mcp", (req, res) => res.status(200).end());

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Tiendanube MCP server escuchando en puerto ${PORT}`);
});
