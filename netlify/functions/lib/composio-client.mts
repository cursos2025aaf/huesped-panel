// netlify/functions/lib/composio-client.mts
//
// Cliente mínimo para invocar acciones de Composio (Calendar, Gmail) desde
// las Netlify Functions de HuésPED. Requiere las variables de entorno:
//   COMPOSIO_API_KEY   - API key de la cuenta Composio (iagentes.tech)
//   COMPOSIO_ENTITY_ID - id de entidad conectada (por defecto "default")
//
// Documentación de acciones: https://docs.composio.dev

const COMPOSIO_BASE_URL = "https://backend.composio.dev/api/v2";

interface ComposioExecuteResponse<T = unknown> {
  successful: boolean;
  data: T;
  error?: string;
}

async function executeAction<T = unknown>(
  actionName: string,
  params: Record<string, unknown>
): Promise<T> {
  const apiKey = Netlify.env.get("COMPOSIO_API_KEY");
  const entityId = Netlify.env.get("COMPOSIO_ENTITY_ID") ?? "default";

  if (!apiKey) {
    throw new Error("Falta configurar COMPOSIO_API_KEY en las variables de entorno de Netlify.");
  }

  const res = await fetch(`${COMPOSIO_BASE_URL}/actions/${actionName}/execute`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": apiKey,
    },
    body: JSON.stringify({
      entityId,
      input: params,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Composio ${actionName} respondió ${res.status}: ${text}`);
  }

  const json = (await res.json()) as ComposioExecuteResponse<T>;
  if (!json.successful) {
    throw new Error(`Composio ${actionName} falló: ${json.error ?? "sin detalle"}`);
  }
  return json.data;
}

export interface DisponibilidadParams {
  calendarId: string;
  fechaInicioISO: string;
  fechaFinISO: string;
}

export interface EventoCalendar {
  id: string;
  start: string;
  end: string;
  summary: string;
}

// Chequea eventos existentes en el rango solicitado para decidir si la
// unidad está disponible. La decisión de disponibilidad por unidad física
// (qué carpa/cabaña/sitio puntual) se resuelve comparando este listado
// contra el mapa de unidades del negocio, guardado en Google Sheets.
export async function chequearDisponibilidad(
  params: DisponibilidadParams
): Promise<EventoCalendar[]> {
  const data = await executeAction<{ items: EventoCalendar[] }>(
    "GOOGLECALENDAR_LIST_EVENTS",
    {
      calendarId: params.calendarId,
      timeMin: params.fechaInicioISO,
      timeMax: params.fechaFinISO,
      singleEvents: true,
    }
  );
  return data.items ?? [];
}

export interface CrearReservaParams {
  calendarId: string;
  titulo: string;
  descripcion: string;
  fechaInicioISO: string;
  fechaFinISO: string;
  emailHuesped: string;
}

export async function crearReservaEnCalendar(
  params: CrearReservaParams
): Promise<EventoCalendar> {
  return executeAction<EventoCalendar>("GOOGLECALENDAR_CREATE_EVENT", {
    calendarId: params.calendarId,
    summary: params.titulo,
    description: params.descripcion,
    start: { dateTime: params.fechaInicioISO },
    end: { dateTime: params.fechaFinISO },
    attendees: [{ email: params.emailHuesped }],
  });
}

export interface EnviarEmailParams {
  destinatario: string;
  asunto: string;
  cuerpoHtml: string;
}

export async function enviarEmail(params: EnviarEmailParams): Promise<void> {
  await executeAction("GMAIL_SEND_EMAIL", {
    recipient_email: params.destinatario,
    subject: params.asunto,
    body: params.cuerpoHtml,
    is_html: true,
  });
}
