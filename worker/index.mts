// worker/index.mts
//
// Entrypoint del Worker de Cloudflare para HuésPED. Reemplaza el enrutado
// que antes hacía Netlify (un archivo = una ruta) por un router explícito
// que llama a las MISMAS funciones ya construidas y probadas en
// netlify/functions/*.mts — no se reescribió la lógica de los agentes,
// solo el "cableado" de qué ruta llama a qué función y de dónde vienen las
// variables de entorno (ver lib/env-shim.mts).
//
// Los archivos estáticos (index.html) los sirve Cloudflare directamente
// desde /public vía el binding ASSETS (ver wrangler.jsonc), sin pasar por
// este Worker salvo que no matcheen ninguna ruta de /api/*.

import { setEnv } from "../netlify/functions/lib/env-shim.mts";
import agenteAtencion from "../netlify/functions/agente-atencion.mts";
import agenteCobro from "../netlify/functions/agente-cobro.mts";
import panelDatos from "../netlify/functions/panel-datos.mts";
import panelSecciones from "../netlify/functions/panel-secciones.mts";
import webhookMercadopago from "../netlify/functions/webhook-mercadopago.mts";
import webhookWhatsapp from "../netlify/functions/webhook-whatsapp.mts";

type Handler = (req: Request, context: unknown) => Promise<Response>;

const RUTAS: Record<string, Handler> = {
  "/api/atencion": agenteAtencion as Handler,
  "/api/cobro": agenteCobro as Handler,
  "/api/panel-datos": panelDatos as Handler,
  "/api/panel-secciones": panelSecciones as Handler,
  "/api/webhook-mercadopago": webhookMercadopago as Handler,
  "/api/webhook-whatsapp": webhookWhatsapp as Handler,
};

export interface Env {
  ASSETS: Fetcher;
  ANTHROPIC_API_KEY?: string;
  COMPOSIO_API_KEY?: string;
  COMPOSIO_ENTITY_ID?: string;
  MERCADOPAGO_ACCESS_TOKEN?: string;
  MERCADOPAGO_WEBHOOK_SECRET?: string;
  WHATSAPP_PHONE_NUMBER_ID?: string;
  WHATSAPP_VERIFY_TOKEN?: string;
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    // env es el mismo objeto de bindings en cada request de este Worker
    // desplegado — ver el comentario en env-shim.mts sobre por qué esto es
    // seguro pese a ser una asignación a una variable de módulo.
    setEnv(env as unknown as Record<string, string | undefined>);

    const url = new URL(request.url);
    const handler = RUTAS[url.pathname];

    if (handler) {
      try {
        return await handler(request, {});
      } catch (err) {
        return new Response(
          JSON.stringify({ error: err instanceof Error ? err.message : "Error desconocido" }),
          { status: 500, headers: { "Content-Type": "application/json" } }
        );
      }
    }

    // Cualquier otra ruta (/, /index.html, etc.) la sirve el binding de
    // static assets.
    return env.ASSETS.fetch(request);
  },
};
