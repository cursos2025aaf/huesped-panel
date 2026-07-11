// netlify/functions/lib/pagos-client.mts
//
// Riel de cobro de HuésPED: MercadoPago Checkout Pro. Un solo proveedor
// para huésped local e internacional — MercadoPago acepta tarjetas de
// crédito/débito internacionales (Visa, Mastercard, Amex) y las cobra
// convertidas a pesos, así que no hace falta un segundo proveedor para
// cubrir al huésped extranjero.
//
// Variable de entorno requerida:
//   MERCADOPAGO_ACCESS_TOKEN

import { envGet } from "./env-shim.mts";
export interface LinkPagoParams {
  montoARS?: number;
  descripcion: string;
  referenciaReserva: string;
  emailHuesped: string;
}

export interface LinkPagoResultado {
  proveedor: "mercadopago";
  url: string;
}

export async function crearLinkMercadoPago(
  params: LinkPagoParams
): Promise<LinkPagoResultado> {
  const accessToken = envGet("MERCADOPAGO_ACCESS_TOKEN");
  if (!accessToken) {
    throw new Error("Falta configurar MERCADOPAGO_ACCESS_TOKEN en Netlify.");
  }
  if (!params.montoARS) {
    throw new Error("crearLinkMercadoPago requiere montoARS.");
  }

  const res = await fetch("https://api.mercadopago.com/checkout/preferences", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      items: [
        {
          title: params.descripcion,
          quantity: 1,
          currency_id: "ARS",
          unit_price: params.montoARS,
        },
      ],
      payer: { email: params.emailHuesped },
      external_reference: params.referenciaReserva,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`MercadoPago respondió ${res.status}: ${text}`);
  }

  const json = (await res.json()) as { init_point: string };
  return { proveedor: "mercadopago", url: json.init_point };
}

// Punto único de entrada para generar el link de cobro. Se mantiene esta
// función (en lugar de llamar a crearLinkMercadoPago directamente desde el
// Agente de Cobro) para que, si en el futuro se suma otro medio de pago,
// el cambio quede aislado acá y no en el agente.
export async function generarLinkDePago(
  params: LinkPagoParams
): Promise<LinkPagoResultado> {
  return crearLinkMercadoPago(params);
}

export interface PagoMercadoPago {
  id: string;
  status: string; // "approved" | "pending" | "rejected" | "in_process" | "cancelled" | "refunded"
  status_detail: string;
  transaction_amount: number;
  external_reference: string | null; // el reservaId (id del evento de Calendar) que se pasó al crear el link
  date_approved: string | null;
  date_created: string;
}

// Consulta el estado REAL de un pago contra la API de MercadoPago (nunca se
// confía en el contenido del webhook por sí solo: el webhook solo avisa
// "pasó algo con el pago X", y este llamado trae el estado verdadero con
// el access token real de la cuenta). Usado por webhook-mercadopago.mts.
export async function consultarPago(paymentId: string): Promise<PagoMercadoPago> {
  const accessToken = envGet("MERCADOPAGO_ACCESS_TOKEN");
  if (!accessToken) {
    throw new Error("Falta configurar MERCADOPAGO_ACCESS_TOKEN en Netlify.");
  }
  const res = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`MercadoPago (consulta de pago) respondió ${res.status}: ${text}`);
  }
  return (await res.json()) as PagoMercadoPago;
}
