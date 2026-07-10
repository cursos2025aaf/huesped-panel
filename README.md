# HuésPED — Sistema Multiagente de Reservas

Producto IAGENTES.TECH para el rubro Hotelería y Turismo. Motor único (Agente
de Atención + Agente de Cobro + panel) con perfiles de modalidad seleccionables:
balneario, camping, cabañas, hostería.

Ver el briefing completo en Drive: `BRIEFING_HuesPED_Sistema_Multiagente_Reservas.md`.

## Estructura

- `index.html` — panel visual (dashboard) con datos de ejemplo para las 4 modalidades.
- `netlify/functions/lib/perfiles.mts` — los 4 perfiles de modalidad (unidad, granularidad, cobro, upsell).
- `netlify/functions/lib/negocios.mts` — inventario de unidades físicas por negocio (ej. "los-alerces" → 12 cabañas), usado para el mapa de unidades.
- `netlify/functions/lib/composio-client.mts` — cliente para Google Calendar y Gmail vía Composio. Incluye `buscarUnidadLibre()`: asigna automáticamente la primera unidad física libre para un rango de fechas, etiquetando cada evento de Calendar con su unidad (`extendedProperties.private.unidad`) en vez de necesitar un calendario por unidad.
- `netlify/functions/lib/pagos-client.mts` — riel de cobro (MercadoPago Checkout Pro, acepta tarjetas locales e internacionales).
- `netlify/functions/agente-atencion.mts` — Agente A: `POST /api/atencion`. Ahora asigna una unidad física concreta (ej. "Cabaña 3") por cada reserva, no solo verifica disponibilidad genérica.
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
Agentes A y B: código real construido y probado de punta a punta (Calendar +
Gmail + link de pago MercadoPago). Variables cargadas en Netlify:
`ANTHROPIC_API_KEY`, `COMPOSIO_API_KEY`, `MERCADOPAGO_ACCESS_TOKEN` (token
de prueba/sandbox). Mapa de unidades físicas: implementado y probado
(asigna automáticamente una unidad concreta por reserva y detecta cuando
no queda ninguna libre). Pendiente: pasar el token de MercadoPago a
producción, conectar el panel a datos reales, y sumar el canal de entrada
por WhatsApp. Sin las claves, las funciones responden error claro
indicando qué variable falta — no fallan en silencio.

## Nota técnica importante (Composio)

Las llamadas a la API REST v3 de Composio (`executeAction` en
`composio-client.mts`) **siempre** deben incluir `"version": "latest"` en
el body. Sin este campo, la API ejecuta silenciosamente una versión vieja
fija del tool ("00000000_00") que ignora parámetros como `end_datetime` y
`extended_properties` sin devolver ningún error — se detectó en pruebas
reales que, sin este campo, las reservas se creaban con 30 minutos de
duración en vez de respetar las fechas pedidas. Ya está corregido, pero
importante no perder este dato si se agregan nuevas acciones de Composio.
