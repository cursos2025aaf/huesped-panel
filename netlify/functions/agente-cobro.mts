// netlify/functions/agente-cobro.mts
//
// AGENTE B — Cobro.
// Se dispara cuando el Agente de Atención confirma una reserva. Genera el
// link de pago por MercadoPago (único riel — acepta tarjetas locales e
// internacionales) según el perfil de modalidad, y lo envía por email.
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
import { getPerfil } from "./lib/perfiles.mts";
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
    const perfil = getPerfil(modalidad as any);

    // El monto a cobrar depende de la lógica de cobro del perfil: total
    // anticipado (hostería) o seña sobre el total (resto de modalidades).
    const factorCobro =
      perfil.cobro.timing === "anticipado_total" ? 1 : perfil.cobro.porcentajeSenal / 100;

    const montoARS = Math.round(montoTotalARS * factorCobro);

    const link = await generarLinkDePago({
      montoARS,
      descripcion: `${descripcionReserva} (${perfil.cobro.timing === "anticipado_total" ? "pago total" : `seña ${perfil.cobro.porcentajeSenal}%`})`,
      referenciaReserva: reservaId,
      emailHuesped,
    });

    const cuerpoHtml = `
      <p>Hola,</p>
      <p>Tu reserva (<strong>${descripcionReserva}</strong>) está confirmada.</p>
      <p>Para asegurarla, completá el pago${
        perfil.cobro.timing === "anticipado_total" ? "" : ` de la seña (${perfil.cobro.porcentajeSenal}%)`
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
