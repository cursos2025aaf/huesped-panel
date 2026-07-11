// netlify/functions/lib/env-shim.mts
//
// Permite que el mismo código de las librerías (composio-client,
// pagos-client, etc.) funcione tanto en Netlify Functions (variable global
// `Netlify.env.get`) como en Cloudflare Workers (bindings inyectados por
// parámetro `env`, sin variable global nativa). El Worker de Cloudflare
// llama a setEnv(env) una sola vez al principio de cada request — como
// `env` es siempre el mismo objeto de bindings para el Worker desplegado
// (no cambia entre requests), esto es seguro aunque el runtime procese
// pedidos concurrentes en el mismo isolate.
let cloudflareEnv: Record<string, string | undefined> | null = null;

export function setEnv(env: Record<string, string | undefined>): void {
  cloudflareEnv = env;
}

export function envGet(key: string): string | undefined {
  if (typeof Netlify !== "undefined" && (Netlify as any)?.env?.get) {
    return (Netlify as any).env.get(key);
  }
  return cloudflareEnv?.[key];
}
