// netlify/functions/webhook-whatsapp.mts
//
// Canal de entrada real por WhatsApp Business (Meta Cloud API vía Composio).
//
// Requisitos PREVIOS que no dependen de este código (a cargo de Andrés):
//   1. Cuenta de Meta Business + WhatsApp Business Account (WABA) verificada.
//   2. Conectar el toolkit "whatsapp" en Composio (Auth Config + conexión),
//      igual que se hizo con Calendar/Gmail.
//   3. Cargar en Netlify:
//      - WHATSAPP_PHONE_NUMBER_ID (el ID numérico que asigna Meta al número,
//        se obtiene con WHATSAPP_GET_PHONE_NUMBERS una vez conectado)
//      - WHATSAPP_VERIFY_TOKEN (un string inventado por Andrés, el mismo que
//        se carga en Meta > WhatsApp > Configuration > Webhook > Verify token)
//   4. Configurar en Meta (App Dashboard > WhatsApp > Configuration > Webhook):
//        Callback URL: https://huesped-iagentes.netlify.app/api/webhook-whatsapp
//        Verify token: el mismo valor de WHATSAPP_VERIFY_TOKEN
//      y suscribirse al campo "messages".
//
// LÍMITE ACTUAL, a propósito documentado (no inventar que esto ya cobra solo):
// HuésPED todavía no tiene una tabla de precios/tarifas por unidad, así que
// este webhook NO dispara automáticamente al Agente de Cobro (no hay forma
// honesta de calcular el monto a cobrar sin inventar un precio). Confirma la
// reserva y la unidad asignada, y avisa que el link de pago lo manda el
// equipo — hasta que exista una tarifa configurada por negocio.
//
// Negocio fijo por ahora: solo hay un negocio real cargado (los-alerces).
// Cuando haya más negocios habrá que enrutar por WHATSAPP_PHONE_NUMBER_ID
// recibido en el payload en vez de hardcodearlo.

import type { Context, Config } from "@netlify/functions";
import { enviarWhatsApp } from "./lib/composio-client.mts";

const NEGOCIO_ID = "los-alerces";
const MODALIDAD = "cabanas";
const CALENDAR_ID = "primary";

interface WhatsAppEntradaMensaje {
  from: string;
  id: string;
  timestamp: string;
  text?: { body: string };
  type: string;
}

function extraerMensaje(body: any): WhatsAppEntradaMensaje | null {
  try {
    const value = body?.entry?.[0]?.changes?.[0]?.value;
    const mensajes = value?.messages;
    if (!mensajes || mensajes.length === 0) return null;
    return mensajes[0] as WhatsAppEntradaMensaje;
  } catch {
    return null;
  }
}

export default async (req: Request, _context: Context): Promise<Response> => {
  const url = new URL(req.url);

  // --- Verificación del webhook (handshake inicial que exige Meta) ---
  if (req.method === "GET") {
    const modo = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    const verifyToken = Netlify.env.get("WHATSAPP_VERIFY_TOKEN");

    if (!verifyToken) {
      return new Response("Falta configurar WHATSAPP_VERIFY_TOKEN en Netlify.", { status: 500 });
    }
    if (modo === "subscribe" && token === verifyToken && challenge) {
      return new Response(challenge, { status: 200 });
    }
    return new Response("Forbidden", { status: 403 });
  }

  if (req.method !== "POST") {
    return new Response("Método no permitido", { status: 405 });
  }

  // Meta espera un 200 rápido; cualquier error interno lo logueamos pero
  // igual respondemos 200 para que Meta no reintente en loop el mismo evento.
  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response("OK", { status: 200 });
  }

  const mensaje = extraerMensaje(body);
  if (!mensaje || mensaje.type !== "text" || !mensaje.text?.body) {
    // Puede ser un evento de "status" (entregado/leído) u otro tipo de
    // mensaje (audio, imagen) que todavía no procesamos.
    return new Response("OK", { status: 200 });
  }

  const numeroHuesped = mensaje.from;
  const phoneNumberId = Netlify.env.get("WHATSAPP_PHONE_NUMBER_ID");

  if (!phoneNumberId) {
    console.error("Falta configurar WHATSAPP_PHONE_NUMBER_ID en Netlify.");
    return new Response("OK", { status: 200 });
  }

  try {
    // Reutiliza el Agente A ya construido y probado (misma lógica, mismo
    // endpoint) en vez de duplicar la interpretación + asignación de unidad.
    const emailPlaceholder = `whatsapp-${numeroHuesped}@sin-email.huesped.tech`;
    const respuestaAtencion = await fetch(`${url.origin}/api/atencion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        negocioId: NEGOCIO_ID,
        modalidad: MODALIDAD,
        calendarId: CALENDAR_ID,
        mensajeHuesped: mensaje.text.body,
        emailHuesped: emailPlaceholder,
      }),
    });
    const resultado = await respuestaAtencion.json();

    let textoRespuesta: string;
    if (!respuestaAtencion.ok || resultado.error) {
      textoRespuesta =
        "Perdón, tuvimos un problema procesando tu consulta. Un miembro del equipo te va a responder a la brevedad.";
      console.error("Error en /api/atencion desde webhook WhatsApp:", resultado.error);
    } else if (resultado.disponible === false) {
      textoRespuesta = `${resultado.mensaje} ¿Querés que te propongamos otras fechas?`;
    } else {
      const interp = resultado.interpretacion;
      textoRespuesta =
        `¡Listo! Reservamos ${resultado.unidadAsignada} del ${interp.fechaInicioISO.slice(0, 10)} ` +
        `al ${interp.fechaFinISO.slice(0, 10)} para ${interp.cantidadPersonas} persona(s).` +
        (resultado.upsellSugerido ? ` Te sumamos también: ${resultado.upsellSugerido}.` : "") +
        ` En breve te enviamos el link de pago de la seña para confirmarla.`;
    }

    await enviarWhatsApp({ phoneNumberId, paraNumero: numeroHuesped, texto: textoRespuesta });
  } catch (err) {
    console.error("Error procesando mensaje de WhatsApp:", err);
  }

  return new Response("OK", { status: 200 });
};

export const config: Config = {
  path: "/api/webhook-whatsapp",
};
