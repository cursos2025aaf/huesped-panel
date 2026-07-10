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
import { buscarUnidadLibre, crearReservaEnCalendar } from "./lib/composio-client.mts";
import { getUnidadesFisicas } from "./lib/negocios.mts";

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
        `Respondé EXCLUSIVAMENTE con JSON válido con las claves: fechaInicioISO, fechaFinISO ` +
        `(SIEMPRE en formato ISO 8601 completo con hora y zona UTC, ej: "2026-07-20T00:00:00Z" — ` +
        `si el huésped no da una hora puntual, usá T00:00:00Z), cantidadPersonas, ` +
        `intencionUpsell (string o null). Sin texto adicional.`,
      messages: [{ role: "user", content: mensaje }],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Claude API respondió ${res.status}: ${text}`);
  }

  const json = (await res.json()) as { content: { text: string }[] };
  let textoRespuesta = (json.content?.[0]?.text ?? "{}").trim();

  // Claude a veces envuelve el JSON en un bloque de código (```json ... ```)
  // aunque el prompt pida "sin texto adicional". Lo sacamos de forma
  // robusta en vez de asumir que la respuesta siempre viene "limpia".
  if (textoRespuesta.startsWith("```")) {
    textoRespuesta = textoRespuesta
      .replace(/^```[a-zA-Z]*\n?/, "")
      .replace(/```\s*$/, "")
      .trim();
  }

  try {
    return JSON.parse(textoRespuesta) as InterpretacionClaude;
  } catch {
    throw new Error(
      `No se pudo interpretar la respuesta de Claude como JSON: ${textoRespuesta.slice(0, 300)}`
    );
  }
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

    const unidadesFisicas = getUnidadesFisicas(negocioId);

    const unidadLibre = await buscarUnidadLibre({
      calendarId,
      unidadesFisicas,
      fechaInicioISO: interpretacion.fechaInicioISO,
      fechaFinISO: interpretacion.fechaFinISO,
    });

    if (!unidadLibre) {
      return new Response(
        JSON.stringify({
          disponible: false,
          mensaje: `No hay ${perfil.nombreUnidadPlural} disponibles para esas fechas. Se sugiere ofrecer fechas alternativas.`,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    const lineaUpsell = interpretacion.intencionUpsell
      ? ` Upsell sugerido: ${interpretacion.intencionUpsell}.`
      : "";

    const evento = await crearReservaEnCalendar({
      calendarId,
      titulo: `Reserva ${unidadLibre} — ${solicitud.emailHuesped}`,
      descripcion: `Reserva generada por Agente de Atención HuésPED. Negocio: ${negocioId}. Unidad: ${unidadLibre}. Personas: ${interpretacion.cantidadPersonas}.${lineaUpsell}`,
      fechaInicioISO: interpretacion.fechaInicioISO,
      fechaFinISO: interpretacion.fechaFinISO,
      emailHuesped,
      unidad: unidadLibre,
    });

    return new Response(
      JSON.stringify({
        disponible: true,
        reservaId: evento.id,
        unidadAsignada: unidadLibre,
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
