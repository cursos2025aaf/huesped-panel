// netlify/functions/lib/pagos-client.mts
//
// Doble riel de cobro de HuésPED: MercadoPago (huésped local, vía el MCP/API
// oficial de Mercado Pago) y Stripe (huésped internacional, vía Composio).
// La elección de riel la decide el Agente de Cobro según el perfil de
// modalidad y el país/moneda del huésped.
//
// Variables de entorno requeridas:
//   MERCADOPAGO_ACCESS_TOKEN
//   STRIPE_SECRET_KEY

export interface LinkPagoParams {
  montoARS?: number;
  montoUSD?: number;
  descripcion: string;
  referenciaReserva: string;
  emailHuesped: string;
}

export interface LinkPagoResultado {
  proveedor: "mercadopago" | "stripe";
  url: string;
}

export async function crearLinkMercadoPago(
  params: LinkPagoParams
): Promise<LinkPagoResultado> {
  const accessToken = Netlify.env.get("MERCADOPAGO_ACCESS_TOKEN");
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

export async function crearLinkStripe(
  params: LinkPagoParams
): Promise<LinkPagoResultado> {
  const secretKey = Netlify.env.get("STRIPE_SECRET_KEY");
  if (!secretKey) {
    throw new Error("Falta configurar STRIPE_SECRET_KEY en Netlify.");
  }
  if (!params.montoUSD) {
    throw new Error("crearLinkStripe requiere montoUSD.");
  }

  const body = new URLSearchParams({
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][product_data][name]": params.descripcion,
    "line_items[0][price_data][unit_amount]": String(Math.round(params.montoUSD * 100)),
    "line_items[0][quantity]": "1",
    mode: "payment",
    "customer_email": params.emailHuesped,
    client_reference_id: params.referenciaReserva,
    success_url: "https://huesped.iagentes.tech/pago-confirmado",
    cancel_url: "https://huesped.iagentes.tech/pago-cancelado",
  });

  const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Bearer ${secretKey}`,
    },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Stripe respondió ${res.status}: ${text}`);
  }

  const json = (await res.json()) as { url: string };
  return { proveedor: "stripe", url: json.url };
}

// Decide el riel de cobro según el perfil de modalidad y el origen del
// huésped. Regla simple y explícita: huésped con email/teléfono de
// Argentina o que pide precio en pesos -> MercadoPago; caso contrario,
// y solo si la modalidad lo permite, Stripe.
export async function generarLinkDePago(
  esHuespedInternacional: boolean,
  params: LinkPagoParams
): Promise<LinkPagoResultado> {
  if (esHuespedInternacional && params.montoUSD) {
    return crearLinkStripe(params);
  }
  return crearLinkMercadoPago(params);
}
