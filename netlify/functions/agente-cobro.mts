// netlify/functions/agente-cobro.mts
//
// AGENTE B — Cobro.
// Se dispara cuando el Agente de Atención confirma una reserva. Genera el
// link de pago por MercadoPago (único riel — acepta tarjetas locales e
// internacionales) según la política de cobro que eligió el negocio
// (seña + saldo, con el % que quiera, o 100% anticipado — ver
// lib/negocios.mts: getConfiguracionCobro), y lo envía por email.
// Diseñado como Netlify Function estándar (no background) porque el
// trabajo es corto: un llamado a la pasarela de pago + un email.
//
// Variables de entorno requeridas:
//   COMPOSIO_API_KEY, COMPOSIO_ENTITY_ID
//   MERCADOPAGO_ACCESS_TOKEN
//
// Body esperado (POST):
// {
//   "negocioId": "los-alerces",
//   "modalidad": "cabanas",
//   "reservaId": "abc123",
//   "emailHuesped": "huesped@example.com",
//   "montoTotalARS": 120000,
//   "descripcionReserva": "2 noches, Cabaña Vista Lago"
// }

import type { Context, Config } from "@netlify/functions";
import { getConfiguracionCobro } from "./lib/negocios.mts";
import { generarLinkDePago } from "./lib/pagos-client.mts";
import { enviarEmail } from "./lib/composio-client.mts";

interface SolicitudCobro {
  negocioId: string;
  modalidad: string;
  reservaId: string;
  emailHuesped: string;
  montoTotalARS: number;
  descripcionReserva: string;
}

export default async (req: Request, _context: Context): Promise<Response> => {
  if (req.method !== "POST") {
    return new Response("Método no permitido", { status: 405 });
  }

  let solicitud: SolicitudCobro;
  try {
    solicitud = (await req.json()) as SolicitudCobro;
  } catch {
    return new Response(JSON.stringify({ error: "Body inválido, se espera JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const {
    negocioId,
    modalidad,
    reservaId,
    emailHuesped,
    montoTotalARS,
    descripcionReserva,
  } = solicitud;

  if (!negocioId || !modalidad || !reservaId || !emailHuesped || !montoTotalARS || !descripcionReserva) {
    return new Response(
      JSON.stringify({
        error:
          "Faltan campos requeridos: negocioId, modalidad, reservaId, emailHuesped, montoTotalARS, descripcionReserva",
      }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
    // La política de cobro es del negocio, no del rubro: cada negocio elige
    // si cobra seña + saldo o el 100% anticipado (ver getConfiguracionCobro).
    // La modalidad solo aporta un default razonable si el negocio no eligió nada.
    const configCobro = getConfiguracionCobro(negocioId);

    const factorCobro =
      configCobro.timing === "anticipado_total" ? 1 : configCobro.porcentajeSenal / 100;

    const montoARS = Math.round(montoTotalARS * factorCobro);

    const link = await generarLinkDePago({
      montoARS,
      descripcion: `${descripcionReserva} (${configCobro.timing === "anticipado_total" ? "pago total" : `seña ${configCobro.porcentajeSenal}%`})`,
      referenciaReserva: reservaId,
      emailHuesped,
    });

    const cuerpoHtml = `
      <p>Hola,</p>
      <p>Tu reserva (<strong>${descripcionReserva}</strong>) está confirmada.</p>
      <p>Para asegurarla, completá el pago${
        configCobro.timing === "anticipado_total" ? "" : ` de la seña (${configCobro.porcentajeSenal}%)`
      } en el siguiente link:</p>
      <p><a href="${link.url}">${link.url}</a></p>
      <p>Cualquier consulta, respondé este mismo email.</p>
    `;

    await enviarEmail({
      destinatario: emailHuesped,
      asunto: `Link de pago — ${descripcionReserva}`,
      cuerpoHtml,
    });

    return new Response(
      JSON.stringify({
        cobroGenerado: true,
        proveedor: link.proveedor,
        montoCobrado: montoARS,
        reservaId,
        linkPago: link.url,
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
  path: "/api/cobro",
};
