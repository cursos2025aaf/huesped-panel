// netlify/functions/lib/composio-client.mts
//
// Cliente mínimo para invocar acciones de Composio (Calendar, Gmail) desde
// las Netlify Functions de HuésPED. Requiere las variables de entorno:
//   COMPOSIO_API_KEY   - API key de la cuenta Composio (iagentes.tech)
//   COMPOSIO_ENTITY_ID - id de entidad/usuario conectado (por defecto "default")
//
// Usa la API REST v3 de Composio (la v2 fue dada de baja — devuelve 410).
// Documentación: https://docs.composio.dev/api-reference

const COMPOSIO_BASE_URL = "https://backend.composio.dev/api/v3";

interface ComposioExecuteResponse<T = unknown> {
  successful: boolean;
  data: T;
  error?: string | null;
}

async function executeAction<T = unknown>(
  actionSlug: string,
  args: Record<string, unknown>
): Promise<T> {
  const apiKey = Netlify.env.get("COMPOSIO_API_KEY");
  const entityId = Netlify.env.get("COMPOSIO_ENTITY_ID") ?? "default";

  if (!apiKey) {
    throw new Error("Falta configurar COMPOSIO_API_KEY en las variables de entorno de Netlify.");
  }

  const res = await fetch(`${COMPOSIO_BASE_URL}/tools/execute/${actionSlug}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify({
      // Se envían ambos por compatibilidad: la cuenta se conectó originalmente
      // como entidad "default"; user_id es el campo vigente en la API v3
      // (entity_id queda deprecado pero todavía se acepta).
      entity_id: entityId,
      user_id: entityId,
      // CRÍTICO: sin esto, la API ejecuta una versión vieja fija del tool
      // ("00000000_00") que ignora silenciosamente parámetros como
      // end_datetime y extended_properties (detectado y confirmado en
      // pruebas reales: sin "version", GOOGLECALENDAR_CREATE_EVENT creaba
      // eventos de 30 minutos en vez de respetar la fecha de fin pedida,
      // y nunca guardaba la unidad física asignada).
      version: "latest",
      arguments: args,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Composio ${actionSlug} respondió ${res.status}: ${text}`);
  }

  const json = (await res.json()) as ComposioExecuteResponse<T>;
  if (!json.successful) {
    throw new Error(`Composio ${actionSlug} falló: ${json.error ?? "sin detalle"}`);
  }
  return json.data;
}

// Normaliza una fecha/hora a un formato RFC3339 completo y válido, tal como
// lo exige la API de Google Calendar. Claude no siempre devuelve el mismo
// formato (a veces solo "2026-07-20", a veces con hora, a veces con zona),
// así que este normalizador cubre los tres casos en lugar de asumir que
// siempre llega "limpio".
function normalizarFechaISO(fechaISO: string): string {
  const soloFecha = /^\d{4}-\d{2}-\d{2}$/;
  if (soloFecha.test(fechaISO)) {
    // Fecha sin hora (reserva de día completo): asumimos medianoche UTC.
    return `${fechaISO}T00:00:00Z`;
  }
  if (/[Zz]$|[+-]\d{2}:?\d{2}$/.test(fechaISO)) {
    // Ya tiene zona horaria explícita.
    return fechaISO;
  }
  // Tiene hora pero sin zona: asumimos UTC.
  return `${fechaISO}Z`;
}

interface RawGoogleCalendarEvent {
  id?: string;
  summary?: string;
  description?: string;
  htmlLink?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
  extendedProperties?: { private?: Record<string, string>; shared?: Record<string, string> };
  attendees?: { email?: string; organizer?: boolean; self?: boolean }[];
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
  descripcion?: string;
  htmlLink?: string;
  unidad?: string;
  emailHuesped?: string;
}

function mapearEvento(raw: RawGoogleCalendarEvent): EventoCalendar {
  // El huésped es el attendee que no es ni organizador ni "self" (esa
  // combinación identifica a la cuenta dueña del Calendar, no al huésped).
  const attendeeHuesped = (raw.attendees ?? []).find((a) => !a.organizer && !a.self);
  return {
    id: raw.id ?? "",
    start: raw.start?.dateTime ?? raw.start?.date ?? "",
    end: raw.end?.dateTime ?? raw.end?.date ?? "",
    summary: raw.summary ?? "",
    descripcion: raw.description,
    htmlLink: raw.htmlLink,
    unidad: raw.extendedProperties?.private?.unidad,
    emailHuesped: attendeeHuesped?.email ?? raw.attendees?.[0]?.email,
  };
}

// Chequea eventos existentes en el rango solicitado para decidir si la
// unidad está disponible. Si se pasa "unidad", filtra solo los eventos
// etiquetados con esa unidad física puntual (ver buscarUnidadLibre).
export async function chequearDisponibilidad(
  params: DisponibilidadParams & { unidad?: string }
): Promise<EventoCalendar[]> {
  const args: Record<string, unknown> = {
    calendarId: params.calendarId,
    timeMin: normalizarFechaISO(params.fechaInicioISO),
    timeMax: normalizarFechaISO(params.fechaFinISO),
    singleEvents: true,
  };
  if (params.unidad) {
    args.privateExtendedProperty = `unidad=${params.unidad}`;
  }
  const data = await executeAction<{ items?: RawGoogleCalendarEvent[] }>(
    "GOOGLECALENDAR_EVENTS_LIST",
    args
  );
  return (data.items ?? []).map(mapearEvento);
}

// Mapa de unidades físicas: recorre el inventario de unidades del negocio
// (carpa/cabaña/sitio/habitación puntual, ver lib/negocios.mts) y devuelve
// la primera que no tenga ningún evento superpuesto en el rango pedido.
// Cada evento de reserva queda etiquetado con su unidad (extendedProperties
// .private.unidad), así que alcanza con Google Calendar — no hace falta un
// calendario por unidad ni una base de datos aparte.
export async function buscarUnidadLibre(params: {
  calendarId: string;
  unidadesFisicas: string[];
  fechaInicioISO: string;
  fechaFinISO: string;
}): Promise<string | null> {
  for (const unidad of params.unidadesFisicas) {
    const eventos = await chequearDisponibilidad({
      calendarId: params.calendarId,
      fechaInicioISO: params.fechaInicioISO,
      fechaFinISO: params.fechaFinISO,
      unidad,
    });
    if (eventos.length === 0) {
      return unidad;
    }
  }
  return null;
}

export interface CrearReservaParams {
  calendarId: string;
  titulo: string;
  descripcion: string;
  fechaInicioISO: string;
  fechaFinISO: string;
  emailHuesped: string;
  unidad: string;
}

export async function crearReservaEnCalendar(
  params: CrearReservaParams
): Promise<EventoCalendar> {
  const data = await executeAction<{ response_data: RawGoogleCalendarEvent }>(
    "GOOGLECALENDAR_CREATE_EVENT",
    {
      calendar_id: params.calendarId,
      summary: params.titulo,
      description: params.descripcion,
      start_datetime: normalizarFechaISO(params.fechaInicioISO),
      end_datetime: normalizarFechaISO(params.fechaFinISO),
      attendees: [params.emailHuesped],
      // Sin link de Google Meet: no aplica a una reserva de alojamiento.
      create_meeting_room: false,
      // Acá queda registrada la unidad física asignada, para que las
      // próximas búsquedas de disponibilidad la puedan filtrar.
      extended_properties: { private: { unidad: params.unidad } },
    }
  );
  return mapearEvento(data.response_data);
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
