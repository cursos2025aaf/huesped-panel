// netlify/functions/panel-secciones.mts
//
// Endpoint único que alimenta las 4 pestañas nuevas del panel (Reservas,
// Disponibilidad, Cobros/base y Upsell, más Configuración) con datos reales
// leídos de Google Calendar y de la config del negocio — nada inventado.
// Se consolida en una sola función para no repetir la misma consulta al
// Calendar cuatro veces.
//
// GET /api/panel-secciones?negocioId=los-alerces&calendarId=primary

import type { Context, Config } from "@netlify/functions";
import { getPerfil } from "./lib/perfiles.mts";
import { getNegocio, getConfiguracionCobro } from "./lib/negocios.mts";
import { chequearDisponibilidad, type EventoCalendar } from "./lib/composio-client.mts";

function inicioDeHoyUTC(): Date {
  const ahora = new Date();
  return new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), ahora.getUTCDate()));
}
function sumarDias(fecha: Date, dias: number): Date {
  const copia = new Date(fecha);
  copia.setUTCDate(copia.getUTCDate() + dias);
  return copia;
}
function fechaISOCorta(fecha: Date): string {
  return fecha.toISOString().slice(0, 10);
}
function parsearPersonas(descripcion?: string): string | null {
  const m = descripcion?.match(/Personas:\\s*(\\d+)/);
  return m ? m[1] : null;
}
function parsearUpsell(descripcion?: string): string | null {
  const m = descripcion?.match(/Upsell sugerido:\\s*([^.]+)\\./);
  return m ? m[1].trim() : null;
}
function iniciales(email?: string): string {
  if (!email) return "??";
  const local = email.split("@")[0];
  const partes = local.split(/[._-]/).filter(Boolean);
  if (partes.length >= 2) return (partes[0][0] + partes[1][0]).toUpperCase();
  return local.slice(0, 2).toUpperCase();
}
function solapa(aInicio: Date, aFin: Date, bInicio: Date, bFin: Date): boolean {
  return aInicio < bFin && bInicio < aFin;
}

export default async (req: Request, _context: Context): Promise<Response> => {
  if (req.method !== "GET") {
    return new Response("Método no permitido", { status: 405 });
  }

  const url = new URL(req.url);
  const negocioId = url.searchParams.get("negocioId") ?? "los-alerces";
  const calendarId = url.searchParams.get("calendarId") ?? "primary";
  const diasGrilla = 14;

  try {
    const negocio = getNegocio(negocioId);
    const perfil = getPerfil(negocio.modalidad);
    const cobro = getConfiguracionCobro(negocioId);

    const hoy = inicioDeHoyUTC();
    const rangoDesde = sumarDias(hoy, -60);
    const rangoHasta = sumarDias(hoy, 90);

    const eventos: EventoCalendar[] = await chequearDisponibilidad({
      calendarId,
      fechaInicioISO: rangoDesde.toISOString(),
      fechaFinISO: rangoHasta.toISOString(),
    });

    const eventosNegocio = eventos.filter(
      (e) => e.unidad && negocio.unidadesFisicas.includes(e.unidad)
    );

    const configuracion = {
      negocioId,
      nombre: negocio.nombre,
      modalidad: perfil.modalidad,
      unidadNombre: perfil.nombreUnidad,
      unidadNombrePlural: perfil.nombreUnidadPlural,
      cantidadUnidades: negocio.unidadesFisicas.length,
      unidadesFisicas: negocio.unidadesFisicas,
      granularidad: perfil.granularidad,
      minimoReserva: perfil.minimoReserva,
      cobro: {
        timing: cobro.timing,
        porcentajeSenal: cobro.porcentajeSenal,
        esPersonalizadoPorNegocio: Boolean(negocio.configuracionCobro),
        medios: perfil.cobro.medios,
      },
      catalogoUpsell: perfil.catalogoUpsell,
      canalPreferido: perfil.canalPreferido,
    };

    const reservas = eventosNegocio
      .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())
      .slice(0, 200)
      .map((e) => {
        const personas = parsearPersonas(e.descripcion);
        const upsell = parsearUpsell(e.descripcion);
        return {
          id: e.id,
          unidad: e.unidad ?? "—",
          huesped: e.emailHuesped ?? "Huésped",
          iniciales: iniciales(e.emailHuesped),
          desde: e.start,
          hasta: e.end,
          personas: personas ? Number(personas) : null,
          upsell,
          esFutura: new Date(e.end) >= hoy,
        };
      });

    const diasGrillaArr = Array.from({ length: diasGrilla }, (_, i) => fechaISOCorta(sumarDias(hoy, i)));
    const disponibilidad = {
      dias: diasGrillaArr,
      unidades: negocio.unidadesFisicas.map((unidad) => {
        const eventosUnidad = eventosNegocio.filter((e) => e.unidad === unidad);
        const ocupados = diasGrillaArr.map((diaISO) => {
          const diaInicio = new Date(`${diaISO}T00:00:00Z`);
          const diaFin = sumarDias(diaInicio, 1);
          return eventosUnidad.some((e) => solapa(new Date(e.start), new Date(e.end), diaInicio, diaFin));
        });
        return { nombre: unidad, ocupados };
      }),
    };

    const conteos: Record<string, number> = {};
    for (const tipo of perfil.catalogoUpsell) conteos[tipo] = 0;
    let totalConUpsell = 0;
    for (const e of eventosNegocio) {
      const upsell = parsearUpsell(e.descripcion);
      if (upsell) {
        conteos[upsell] = (conteos[upsell] ?? 0) + 1;
        totalConUpsell++;
      }
    }
    const upsellResumen = {
      catalogo: perfil.catalogoUpsell,
      conteos,
      totalConUpsell,
      totalReservas: eventosNegocio.length,
    };

    return new Response(
      JSON.stringify({ configuracion, reservas, disponibilidad, upsellResumen }),
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
  path: "/api/panel-secciones",
};
