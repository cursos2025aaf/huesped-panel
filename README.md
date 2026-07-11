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
- `netlify/functions/webhook-whatsapp.mts` — canal de entrada real por WhatsApp Business (Meta Cloud API vía Composio). Construido y desplegado; falta conectar la cuenta real (ver sección abajo).
- `netlify/functions/webhook-mercadopago.mts` — recibe la notificación de MercadoPago cuando cambia el estado de un pago, consulta el pago real contra la API (nunca confía en el body del webhook) y etiqueta el evento de Calendar correspondiente (`extendedProperties.private.pagoEstado/pagoMontoARS/pagoFecha/pagoId`). Construido y desplegado; falta un paso externo (ver sección abajo).
- `netlify/functions/panel-secciones.mts` — endpoint único (`/api/panel-secciones`) que alimenta las 5 pestañas del panel con datos reales: Reservas, Disponibilidad, Cobros, Upsell y Configuración.

## Variables de entorno necesarias (Netlify > Site configuration > Environment variables)

| Variable | Uso |
|---|---|
| `ANTHROPIC_API_KEY` | Interpretar la consulta del huésped (Agente A) |
| `COMPOSIO_API_KEY` | Acciones de Google Calendar y Gmail |
| `COMPOSIO_ENTITY_ID` | Entidad conectada en Composio (cuenta iagentes.tech) |
| `MERCADOPAGO_ACCESS_TOKEN` | Generar links de cobro (local e internacional) |
| `WHATSAPP_PHONE_NUMBER_ID` | Enviar mensajes de WhatsApp (Agente A vía webhook) — pendiente |
| `WHATSAPP_VERIFY_TOKEN` | Handshake de verificación del webhook con Meta — pendiente |

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

## Canal de WhatsApp — qué falta para activarlo

El código ya está construido y desplegado (`/api/webhook-whatsapp`), pero
requiere pasos externos que solo Andrés puede hacer (verificación de cuenta
de negocio, no es algo que se pueda automatizar):

1. Crear/usar una cuenta de Meta Business y dar de alta un WhatsApp Business
   Account (WABA) con un número de teléfono verificado.
2. En el dashboard de Composio: crear un Auth Config para el toolkit
   "whatsapp" y conectar la cuenta (mismo proceso que se hizo con Calendar
   y Gmail).
3. Obtener el `phone_number_id` (con `WHATSAPP_GET_PHONE_NUMBERS` una vez
   conectado) y cargarlo como `WHATSAPP_PHONE_NUMBER_ID` en Netlify.
4. Inventar un `WHATSAPP_VERIFY_TOKEN` (cualquier string) y cargarlo en
   Netlify Y en Meta (App Dashboard > WhatsApp > Configuration > Webhook).
5. Configurar en Meta el Callback URL:
   `https://huesped-iagentes.netlify.app/api/webhook-whatsapp`, con el mismo
   verify token, y suscribirse al campo "messages".

Límite honesto: el webhook confirma la reserva y asigna la unidad, pero
todavía NO dispara el link de pago automáticamente — HuésPED no tiene hoy
una tabla de precios/tarifas por unidad, y calcular un monto a cobrar sin
esa tarifa real sería inventar una cifra. En cuanto exista una tarifa por
negocio, se puede sumar ese último paso.

## Pestaña Cobros — qué falta para activarla del todo

El código ya está construido y desplegado (`/api/webhook-mercadopago` +
`cobrosResumen` en el panel), pero falta un único paso externo, de 1 minuto,
que solo Andrés puede hacer desde el dashboard de MercadoPago:

1. Entrar a MercadoPago > Tus integraciones > la aplicación en uso > Webhooks.
2. Agregar la URL: `https://huesped-iagentes.netlify.app/api/webhook-mercadopago`
3. Suscribirse al evento "Pagos" (payments).

Cómo funciona: al generar un link de cobro (Agente de Cobro), se guarda
`external_reference = reservaId` (el mismo id del evento de Calendar). Cuando
el huésped paga, MercadoPago avisa al webhook; el webhook nunca confía en
el aviso por sí solo — vuelve a consultar el pago real contra la API de
MercadoPago con el access token real, y solo entonces etiqueta el evento de
Calendar correspondiente con el estado verdadero (`approved`, `pending`,
`rejected`, etc.), el monto real cobrado y la fecha real. La pestaña Cobros
del panel lee esas etiquetas — no inventa ni estima montos: una reserva sin
pago registrado simplemente figura como "Sin registrar" hasta que se
confirme un pago real vía este webhook.

## Migración a Cloudflare Workers (en curso)

Ya está deployado y funcionando en paralelo a Netlify:
`https://huesped-iagentes.iagentestech.workers.dev`

Cómo se hizo: se agregó `netlify/functions/lib/env-shim.mts` (función `envGet`
que funciona tanto con `Netlify.env.get` como con los bindings de Cloudflare)
y `worker/index.mts` (entrypoint que enruta /api/* a las MISMAS funciones ya
construidas, sin reescribir su lógica). El sitio estático se sirve desde
`public/index.html` vía el binding `ASSETS`. Config en `wrangler.jsonc`.

Secrets ya cargados en Cloudflare: `MERCADOPAGO_ACCESS_TOKEN`,
`MERCADOPAGO_WEBHOOK_SECRET`. Faltan (Andrés los tiene, no están en texto
plano en ningún lado accesible para esta migración): `ANTHROPIC_API_KEY`,
`COMPOSIO_API_KEY`. Sin esos dos, `/api/atencion`, `/api/panel-datos` y
`/api/panel-secciones` responden con el mismo error claro que ya tenían
diseñado ("Falta configurar X"), no rompen en silencio.

Netlify sigue activo y funcionando sin cambios — el corte final (dejar de
usar Netlify) se hace recién cuando Cloudflare esté 100% verificado.

## Nota técnica importante (Composio)

Las llamadas a la API REST v3 de Composio (`executeAction` en
`composio-client.mts`) **siempre** deben incluir `"version": "latest"` en
el body. Sin este campo, la API ejecuta silenciosamente una versión vieja
fija del tool ("00000000_00") que ignora parámetros como `end_datetime` y
`extended_properties` sin devolver ningún error — se detectó en pruebas
reales que, sin este campo, las reservas se creaban con 30 minutos de
duración en vez de respetar las fechas pedidas. Ya está corregido, pero
importante no perder este dato si se agregan nuevas acciones de Composio.

<!-- deploy trigger: activar MERCADOPAGO_ACCESS_TOKEN de produccion -->

<!-- deploy trigger: activar MERCADOPAGO_WEBHOOK_SECRET -->
