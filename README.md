# HuésPED — Sistema Multiagente de Reservas

Producto IAGENTES.TECH para el rubro Hotelería y Turismo. Motor único (Agente
de Atención + Agente de Cobro + panel) con perfiles de modalidad seleccionables:
balneario, camping, cabañas, hostería.

Ver el briefing completo en Drive: `BRIEFING_HuesPED_Sistema_Multiagente_Reservas.md`.

## Estructura

- `index.html` — panel visual (dashboard) con datos de ejemplo para las 4 modalidades.
- `netlify/functions/lib/perfiles.mts` — los 4 perfiles de modalidad (unidad, granularidad, cobro, upsell).
- `netlify/functions/lib/composio-client.mts` — cliente para Google Calendar y Gmail vía Composio.
- `netlify/functions/lib/pagos-client.mts` — riel de cobro (MercadoPago Checkout Pro, acepta tarjetas locales e internacionales).
- `netlify/functions/agente-atencion.mts` — Agente A: `POST /api/atencion`.
- `netlify/functions/agente-cobro.mts` — Agente B: `POST /api/cobro`.

## Variables de entorno necesarias (Netlify > Site configuration > Environment variables)

| Variable | Uso |
|---|---|
| `ANTHROPIC_API_KEY` | Interpretar la consulta del huésped (Agente A) |
| `COMPOSIO_API_KEY` | Acciones de Google Calendar y Gmail |
| `COMPOSIO_ENTITY_ID` | Entidad conectada en Composio (cuenta iagentes.tech) |
| `MERCADOPAGO_ACCESS_TOKEN` | Generar links de cobro (local e internacional) |

## Nota sobre el cobro internacional

El diseño original contemplaba un doble riel (MercadoPago + Stripe). Se
descartó Stripe porque no soporta la creación de cuentas desde Argentina
(no está en su lista de países habilitados). MercadoPago Checkout Pro ya
acepta tarjetas de crédito/débito internacionales y las cobra convertidas
a pesos, así que cubre ambos casos con un solo proveedor — sin perder
robustez ni cobertura.

## Estado

Panel visual: construido y desplegado.
Agentes A y B: código real construido. Variables cargadas en Netlify:
`ANTHROPIC_API_KEY`, `COMPOSIO_API_KEY`, `MERCADOPAGO_ACCESS_TOKEN` (token
de prueba/sandbox). Pendiente: probar de punta a punta y luego pasar el
token de MercadoPago a producción. Sin las claves, las funciones responden
error claro indicando qué variable falta — no fallan en silencio.
