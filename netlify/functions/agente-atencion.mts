// netlify/functions/agente-atencion.mts
//
// AGENTE A — Atención.
// Recibe la consulta del huésped (WhatsApp/web/email ya normalizada a texto
// por el canal de entrada), consulta disponibilidad real en Google Calendar
// según la granularidad del perfil de modalidad, confirma la reserva y
// ofrece un upsell contextual tomado del catálogo de esa modalidad.
//
// Variables de entorno requeridas:
//   ANTHROPIC_API_KEY
//   COMPOSIO_API_KEY, COMPOSIO_ENTITY_ID
//
// Body esperado (POST):
// {
//   "negocioId": "los-alerces",
//   "modalidad": "cabanas",
//   "calendarId": "primary",
//   "mensajeHuesped": "Hola, quiero reservar para 4 personas del 12 al 14 de julio",
//   "emailHuesped": "huesped@example.com"
// }

import type { Context, Config } from "@netlify/functions";
import { getPerfil } from "./lib/perfiles.mts";
import { chequearDisponibilidad, crearReservaEnCalendar } from "./lib/composio-client.mts";

interface SolicitudAtencion {
  negocioId: string;
  modalidad: string;
  calendarId: string;
  mensajeHuesped: string;
  emailHuesped: string;
}

interface InterpretacionClaude {
  fechaInicioISO: string;
  fechaFinISO: string;
  cantidadPersonas: number;
  intencionUpsell: string | null;
}

async function interpretarConsulta(
  mensaje: string,
  perfilNombreUnidad: string,
  catalogoUpsell: string[]
): Promise<InterpretacionClaude> {
  const apiKey = Netlify.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    throw new Error("Falta configurar ANTHROPIC_API_KEY en Netlify.");
  }

  const hoy = new Date().toISOString().slice(0, 10);

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-5",
      max_tokens: 512,
      system:
        `Sos el Agente de Atención de HuésPED para un negocio que reserva "${perfilNombreUnidad}". ` +
        `Hoy es ${hoy}. Extraé de la consulta del huésped: fecha de inicio, fecha de fin, cantidad de ` +
        `personas, y si corresponde sugerir alguno de estos extras según el contexto: ${catalogoUpsell.join(", ")}. ` +
        `Respondé EXCLUSIVAMENTE con JSON válido con las claves: fechaInicioISO, fechaFinISO, ` +
        `cantidadPersonas, intencionUpsell (string o null). Sin texto adicional.`,
      messages: [{ role: "user", content: mensaje }],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Claude API respondió ${res.status}: ${text}`);
  }

  const json = (await res.json()) as { content: { text: string }[] };
  const textoRespuesta = json.content?.[0]?.text ?? "{}";
  return JSON.parse(textoRespuesta) as InterpretacionClaude;
}

export default async (req: Request, _context: Context): Promise<Response> => {
  if (req.method !== "POST") {
    return new Response("Método no permitido", { status: 405 });
  }

  let solicitud: SolicitudAtencion;
  try {
    solicitud = (await req.json()) as SolicitudAtencion;
  } catch {
    return new Response(JSON.stringify({ error: "Body inválido, se espera JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { negocioId, modalidad, calendarId, mensajeHuesped, emailHuesped } = solicitud;
  if (!negocioId || !modalidad || !calendarId || !mensajeHuesped || !emailHuesped) {
    return new Response(
      JSON.stringify({
        error:
          "Faltan campos requeridos: negocioId, modalidad, calendarId, mensajeHuesped, emailHuesped",
      }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
    const perfil = getPerfil(modalidad as any);

    const interpretacion = await interpretarConsulta(
      mensajeHuesped,
      perfil.nombreUnidad,
      perfil.catalogoUpsell
    );

    const eventosExistentes = await chequearDisponibilidad({
      calendarId,
      fechaInicioISO: interpretacion.fechaInicioISO,
      fechaFinISO: interpretacion.fechaFinISO,
    });

    if (eventosExistentes.length > 0) {
      return new Response(
        JSON.stringify({
          disponible: false,
          mensaje: `No hay ${perfil.nombreUnidadPlural} disponibles para esas fechas. Se sugiere ofrecer fechas alternativas.`,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    const evento = await crearReservaEnCalendar({
      calendarId,
      titulo: `Reserva ${perfil.nombreUnidad} — ${solicitud.emailHuesped}`,
      descripcion: `Reserva generada por Agente de Atención HuésPED. Negocio: ${negocioId}. Personas: ${interpretacion.cantidadPersonas}.`,
      fechaInicioISO: interpretacion.fechaInicioISO,
      fechaFinISO: interpretacion.fechaFinISO,
      emailHuesped,
    });

    return new Response(
      JSON.stringify({
        disponible: true,
        reservaId: evento.id,
        perfil: perfil.modalidad,
        interpretacion,
        upsellSugerido: interpretacion.intencionUpsell,
        siguientePaso: "El Agente de Cobro generará el link de pago para esta reserva.",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Error desconocido" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};

export const config: Config = {
  path: "/api/atencion",
};
