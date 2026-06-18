# Tiendanube MCP Server (simple, solo lectura)

Servidor MCP minimalista para conectar tu tienda de Tiendanube/Nuvemshop con Claude Cowork.
Permite consultar productos, pedidos, clientes y categorías. No modifica ni borra nada.

## Herramientas disponibles

- `get_store_info` — datos generales de la tienda
- `list_products` / `get_product` — productos y su detalle (incluye stock y variantes)
- `list_orders` / `get_order` — pedidos y su detalle
- `list_customers` / `get_customer` — clientes y su detalle
- `list_categories` — categorías de productos

## 1. Probarlo en tu computadora (opcional)

```bash
npm install
cp .env.example .env
# Editá .env y completá TIENDANUBE_ACCESS_TOKEN y TIENDANUBE_USER_ID
npm start
```

El servidor queda escuchando en `http://localhost:8080/mcp`.

## 2. Subir el código a GitHub

```bash
git init
git add .
git commit -m "Tiendanube MCP server"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/tiendanube-mcp.git
git push -u origin main
```

(Creá antes un repo vacío en GitHub si no tenés uno.)

## 3. Desplegar en Railway

1. Andá a https://railway.app y logueate con GitHub
2. **New Project → Deploy from GitHub repo** → elegí el repo que acabás de subir
3. Railway detecta automáticamente que es un proyecto Node.js
4. Andá a la pestaña **Variables** del proyecto y agregá:
   - `TIENDANUBE_ACCESS_TOKEN` = tu access token
   - `TIENDANUBE_USER_ID` = tu store id
   - `TIENDANUBE_USER_AGENT` = `Cowork Integration (tu-email@ejemplo.com)`
5. En **Settings → Networking**, generá un dominio público (botón "Generate Domain")
6. Vas a obtener una URL pública, algo como `https://tiendanube-mcp-production.up.railway.app`

Tu endpoint MCP queda en:
```
https://TU-DOMINIO.up.railway.app/mcp
```

## 4. Conectarlo en Claude Cowork

1. En Cowork: **Customize → Connectors → "+"**
2. Elegí agregar un **conector personalizado**
3. Nombre: `Tiendanube` (o el que quieras)
4. URL: `https://TU-DOMINIO.up.railway.app/mcp`
5. Guardá y conectá

Listo — ya podés pedirle a Claude cosas como "mostrame los últimos 10 pedidos" o
"buscá el producto X y decime el stock disponible".

## Notas de seguridad

- El `access_token` da acceso a los datos de tu tienda. No lo subas a un repo
  público (el `.gitignore` ya excluye `.env`).
- Este servidor es de **solo lectura**: no incluye herramientas para crear, editar
  o borrar nada en tu tienda.
- Los endpoints `/webhooks/*` son los requeridos por Tiendanube para cumplimiento
  de privacidad (devuelven 200 OK; este servidor no almacena datos de clientes).
