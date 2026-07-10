# HuésPED — Sistema Multiagente de Reservas

Producto IAGENTES.TECH para el rubro Hotelería y Turismo. Motor único (Agente
de Atención + Agente de Cobro + panel) con perfiles de modalidad seleccionables:
balneario, camping, cabañas, hostería.

Ver el briefing completo en Drive: `BRIEFING_HuesPED_Sistema_Multiagente_Reservas.md`.

## Estructura

- `index.html` — panel visual (dashboard) con datos de ejemplo para las 4 modalidades.
- `netlify/functions/lib/perfiles.mts` — los 4 perfiles de modalidad (unidad, granularidad, cobro, upsell).
- `netlify/functions/lib/composio-client.mts` — cliente para Google Calendar y Gmail vía Composio.
- `netlify/functions/lib/pagos-client.mts` — doble riel de cobro (MercadoPago + Stripe).
- `netlify/functions/agente-atencion.mts` — Agente A: `POST /api/atencion`.
- `netlify/functions/agente-cobro.mts` — Agente B: `POST /api/cobro`.

## Variables de entorno necesarias (Netlify > Site configuration > Environment variables)

| Variable | Uso |
|---|---|
| `ANTHROPIC_API_KEY` | Interpretar la consulta del huésped (Agente A) |
| `COMPOSIO_API_KEY` | Acciones de Google Calendar y Gmail |
| `COMPOSIO_ENTITY_ID` | Entidad conectada en Composio (cuenta iagentes.tech) |
| `MERCADOPAGO_ACCESS_TOKEN` | Generar links de cobro en pesos |
| `STRIPE_SECRET_KEY` | Generar links de cobro para huésped internacional |

## Estado

Panel visual: construido y desplegado.
Agentes A y B: código real construido, pendiente de cargar las variables de
entorno de producción (claves propias de IAGENTES.TECH/cliente) para operar
en vivo. Sin esas claves, las funciones responden error claro indicando qué
variable falta — no fallan en silencio.
