import express from "express";
import crypto from "node:crypto";
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
app.use(express.urlencoded({ extended: true }));

app.post("/webhooks/store-redact", (req, res) => res.sendStatus(200));
app.post("/webhooks/customer-redact", (req, res) => res.sendStatus(200));
app.post("/webhooks/customer-data-request", (req, res) => res.sendStatus(200));

// Health check simple, útil para Railway
app.get("/", (req, res) => res.send("Tiendanube MCP server OK"));

// ---------------------------------------------------------------------------
// "OAuth de cortesía": Cowork siempre intenta un login OAuth al conectar un
// conector personalizado, aunque el servidor no lo necesite. Como este
// servidor es de uso personal (la autenticación real con Tiendanube ya está
// embebida server-side via TIENDANUBE_ACCESS_TOKEN), este flujo auto-aprueba
// todo sin pedir login: solo existe para satisfacer el protocolo OAuth/DCR
// que el cliente espera.
// ---------------------------------------------------------------------------
function baseUrl(req) {
  return `${req.protocol}://${req.get("host")}`;
}

const registeredClients = new Map(); // client_id -> metadata
const authCodes = new Map(); // code -> { redirect_uri, expires }
const accessTokens = new Set(); // tokens válidos emitidos por este servidor

app.get("/.well-known/oauth-authorization-server", (req, res) => {
  const b = baseUrl(req);
  res.json({
    issuer: b,
    authorization_endpoint: `${b}/oauth/authorize`,
    token_endpoint: `${b}/oauth/token`,
    registration_endpoint: `${b}/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256", "plain"],
    token_endpoint_auth_methods_supported: ["none"],
  });
});

app.get("/.well-known/oauth-protected-resource", (req, res) => {
  const b = baseUrl(req);
  res.json({
    resource: `${b}/mcp`,
    authorization_servers: [b],
  });
});

// Dynamic Client Registration (RFC 7591) — acepta cualquier cliente
app.post("/oauth/register", (req, res) => {
  const client_id = crypto.randomUUID();
  const metadata = {
    client_id,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    redirect_uris: req.body?.redirect_uris || [],
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code"],
    response_types: ["code"],
    ...req.body,
    client_id, // aseguramos que no se pisotee
  };
  registeredClients.set(client_id, metadata);
  res.status(201).json(metadata);
});

// Auto-aprueba: no hay pantalla de login, redirige directo con un code
app.get("/oauth/authorize", (req, res) => {
  const { redirect_uri, state } = req.query;
  if (!redirect_uri) {
    return res.status(400).send("Falta redirect_uri");
  }
  const code = crypto.randomUUID();
  authCodes.set(code, { redirect_uri, expires: Date.now() + 5 * 60 * 1000 });

  const redirect = new URL(redirect_uri);
  redirect.searchParams.set("code", code);
  if (state) redirect.searchParams.set("state", state);
  res.redirect(302, redirect.toString());
});

// Intercambio de code por access_token
app.post("/oauth/token", (req, res) => {
  const { code } = req.body || {};
  const entry = authCodes.get(code);
  if (!entry || entry.expires < Date.now()) {
    return res.status(400).json({ error: "invalid_grant" });
  }
  authCodes.delete(code);

  const access_token = crypto.randomUUID();
  accessTokens.add(access_token);

  res.json({
    access_token,
    token_type: "bearer",
    expires_in: 31536000, // 1 año
  });
});

// ---------------------------------------------------------------------------
// Endpoint MCP (modo stateless: una transport nueva por request)
// Protegido por el token emitido en el flujo OAuth de arriba.
// ---------------------------------------------------------------------------
function requireAuth(req, res, next) {
  const authHeader = req.get("authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token || !accessTokens.has(token)) {
    res
      .status(401)
      .set("WWW-Authenticate", `Bearer resource_metadata="${baseUrl(req)}/.well-known/oauth-protected-resource"`)
      .json({ error: "unauthorized" });
    return;
  }
  next();
}

app.post("/mcp", requireAuth, async (req, res) => {
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
app.get("/mcp", requireAuth, (req, res) => {
  res.status(405).json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed. This server only supports POST for /mcp." },
    id: null,
  });
});
app.delete("/mcp", requireAuth, (req, res) => res.status(200).end());

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Tiendanube MCP server escuchando en puerto ${PORT}`);
});
