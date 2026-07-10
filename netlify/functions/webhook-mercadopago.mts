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
// Requisito EXTERNO (a cargo de Andrés, un paso de 1 minuto — YA HECHO):
//   MercadoPago > Tus integraciones > tu aplicación > Webhooks (modo
//   productivo) > URL: https://huesped-iagentes.netlify.app/api/webhook-mercadopago
//   suscripto al evento "Pagos". La clave secreta que entrega MercadoPago
//   al guardar se cargó como MERCADOPAGO_WEBHOOK_SECRET en Netlify y se usa
//   acá para validar la firma HMAC de cada notificación (ver validarFirma).
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
import crypto from "node:crypto";
import { consultarPago } from "./lib/pagos-client.mts";
import { actualizarPagoEnEvento } from "./lib/composio-client.mts";

// Valida que la notificación realmente venga de MercadoPago (y no de un
// tercero simulando un webhook), usando el esquema oficial de firma HMAC:
// https://www.mercadopago.com.ar/developers/es/docs/your-integrations/notifications/webhooks
// Si todavía no hay MERCADOPAGO_WEBHOOK_SECRET configurado, se deja pasar
// la notificación (con una advertencia) para no romper mientras se termina
// de configurar; una vez cargada la clave, se exige que la firma sea válida.
function validarFirma(req: Request, url: URL): boolean {
  const secret = Netlify.env.get("MERCADOPAGO_WEBHOOK_SECRET");
  if (!secret) {
    console.warn("MERCADOPAGO_WEBHOOK_SECRET no configurado: no se valida la firma del webhook.");
    return true;
  }

  const xSignature = req.headers.get("x-signature");
  const xRequestId = req.headers.get("x-request-id");
  const dataId = url.searchParams.get("data.id") ?? url.searchParams.get("id");

  if (!xSignature || !xRequestId || !dataId) {
    console.error("Falta x-signature, x-request-id o data.id en la notificación: no se puede validar.");
    return false;
  }

  const partes: Record<string, string> = {};
  for (const par of xSignature.split(",")) {
    const [clave, valor] = par.split("=");
    if (clave) partes[clave.trim()] = (valor ?? "").trim();
  }
  const ts = partes.ts;
  const v1 = partes.v1;
  if (!ts || !v1) {
    console.error("x-signature con formato inesperado:", xSignature);
    return false;
  }

  const manifest = `id:${dataId.toLowerCase()};request-id:${xRequestId};ts:${ts};`;
  const hashEsperado = crypto.createHmac("sha256", secret).update(manifest).digest("hex");

  return hashEsperado === v1;
}

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

  if (!validarFirma(req, url)) {
    console.error("Firma de webhook de MercadoPago inválida — notificación rechazada.");
    return new Response("Firma inválida", { status: 401 });
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
