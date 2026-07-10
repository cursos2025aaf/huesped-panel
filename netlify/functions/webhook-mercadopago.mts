// netlify/functions/webhook-mercadopago.mts
//
// Recibe las notificaciones (webhooks) que manda MercadoPago cuando cambia
// el estado de un pago, y etiqueta la reserva correspondiente en Google
// Calendar con el resultado REAL — nunca se confía en el contenido del
// webhook para decidir si un pago está aprobado: se usa únicamente para
// saber "qué pago mirar", y después se consulta ese pago con el access
// token real contra la API de MercadoPago (ver lib/pagos-client.mts:
// consultarPago). Así, aunque alguien intente falsificar una notificación,
// nunca se puede marcar como pagada una reserva que no tenga un pago
// aprobado de verdad.
//
// Requisito EXTERNO (a cargo de Andrés, un paso de 1 minuto):
//   MercadoPago > Tus integraciones > tu aplicación > Webhooks >
//   agregar URL: https://huesped-iagentes.netlify.app/api/webhook-mercadopago
//   y suscribirse al evento "Pagos" (payments).
//
// Cómo se correlaciona el pago con la reserva: al generar el link de pago
// (agente-cobro.mts), se manda external_reference = reservaId, que es el
// mismo id del evento de Google Calendar (ver agente-atencion.mts:
// reservaId = evento.id). Por eso alcanza con Calendar como única fuente
// de verdad, sin necesidad de una base de datos aparte.
//
// Negocio fijo por ahora: solo hay un negocio real cargado (los-alerces),
// mismo criterio que en webhook-whatsapp.mts. Cuando haya más negocios,
// calendarId debería resolverse a partir del negocio dueño de la reserva
// en vez de asumir "primary".

import type { Context, Config } from "@netlify/functions";
import { consultarPago } from "./lib/pagos-client.mts";
import { actualizarPagoEnEvento } from "./lib/composio-client.mts";

const CALENDAR_ID = "primary";

// MercadoPago manda el aviso de dos formas posibles según la integración:
// como querystring (?type=payment&data.id=123) o como body JSON
// ({ type: "payment", data: { id: "123" } }, a veces con action en vez de
// type). Cubrimos ambos casos en vez de asumir uno solo.
function extraerPaymentId(url: URL, body: any): string | null {
  const idQuery = url.searchParams.get("data.id") ?? url.searchParams.get("id");
  const tipoQuery = url.searchParams.get("type") ?? url.searchParams.get("topic");
  if (idQuery && (tipoQuery === "payment" || tipoQuery === null)) {
    return idQuery;
  }
  const tipoBody = body?.type ?? body?.action?.split(".")?.[0];
  const idBody = body?.data?.id;
  if (idBody && (tipoBody === "payment" || tipoBody === undefined)) {
    return String(idBody);
  }
  return null;
}

export default async (req: Request, _context: Context): Promise<Response> => {
  const url = new URL(req.url);

  // MercadoPago a veces hace un GET simple al guardar la URL en el
  // dashboard, solo para confirmar que responde. No hay handshake como el
  // de Meta: alcanza con devolver 200.
  if (req.method === "GET") {
    return new Response("OK", { status: 200 });
  }

  if (req.method !== "POST") {
    return new Response("Método no permitido", { status: 405 });
  }

  let body: any = null;
  try {
    body = await req.json();
  } catch {
    // Puede llegar sin body si vino solo por querystring; no es un error.
  }

  // MercadoPago espera un 200 rápido; cualquier error interno se loguea
  // pero igual se responde 200 para que no reintente en loop el mismo evento.
  try {
    const paymentId = extraerPaymentId(url, body);
    if (!paymentId) {
      // Puede ser una notificación de otro tipo (merchant_order, etc.) que
      // todavía no procesamos.
      return new Response("OK", { status: 200 });
    }

    const pago = await consultarPago(paymentId);

    if (!pago.external_reference) {
      console.warn(`Pago ${pago.id} sin external_reference: no se puede asociar a una reserva.`);
      return new Response("OK", { status: 200 });
    }

    await actualizarPagoEnEvento({
      calendarId: CALENDAR_ID,
      eventId: pago.external_reference,
      pagoEstado: pago.status,
      pagoMontoARS: pago.transaction_amount,
      pagoId: String(pago.id),
      pagoFechaISO: pago.date_approved ?? pago.date_created,
    });
  } catch (err) {
    console.error("Error procesando webhook de MercadoPago:", err);
  }

  return new Response("OK", { status: 200 });
};

export const config: Config = {
  path: "/api/webhook-mercadopago",
};
