// netlify/functions/panel-datos.mts
//
// Provee al panel visual (index.html) datos REALES de ocupación y reservas,
// leídos directamente de Google Calendar — nada hardcodeado ni inventado.
//
// IMPORTANTE — límite honesto de esta función: el sistema hoy no lleva un
// registro de pagos efectivamente cobrados (Agente de Cobro solo genera el
// link de MercadoPago, no hay webhook que confirme el pago de vuelta). Por
// eso esta función NO devuelve "ingresos" ni "señas pendientes": mostrar
// esos números sin datos reales detrás sería inventar cifras financieras,
// algo que este proyecto tiene explícitamente prohibido. Devuelve en cambio
// métricas de ocupación y reservas que sí se pueden calcular con certeza
// a partir de los eventos reales del Calendar.
//
// GET /api/panel-datos?negocioId=los-alerces&calendarId=primary

import type { Context, Config } from "@netlify/functions";
import { getPerfil } from "./lib/perfiles.mts";
import { getNegocio } from "./lib/negocios.mts";
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

function inicioDeMesUTC(): Date {
  const ahora = new Date();
  return new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), 1));
}

function diasEnMesActual(): number {
  const ahora = new Date();
  return new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth() + 1, 0)).getUTCDate();
}

function parsearPersonas(descripcion?: string): string | null {
  const m = descripcion?.match(/Personas:\s*(\d+)/);
  return m ? m[1] : null;
}

function parsearUpsell(descripcion?: string): string | null {
  const m = descripcion?.match(/Upsell sugerido:\s*([^.]+)\./);
  return m ? m[1].trim() : null;
}

function iniciales(email?: string): string {
  if (!email) return "??";
  const local = email.split("@")[0];
  const partes = local.split(/[._-]/).filter(Boolean);
  if (partes.length >= 2) return (partes[0][0] + partes[1][0]).toUpperCase();
  return local.slice(0, 2).toUpperCase();
}

function formatearRango(startISO: string, endISO: string): string {
  const start = new Date(startISO);
  const end = new Date(endISO);
  const opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", timeZone: "UTC" };
  const startTxt = start.toLocaleDateString("es-AR", opts);
  const endTxt = end.toLocaleDateString("es-AR", opts);
  const noches = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000));
  if (startTxt === endTxt) return `${startTxt} · día completo`;
  return `${startTxt} al ${endTxt} · ${noches} noche${noches === 1 ? "" : "s"}`;
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

  try {
    const negocio = getNegocio(negocioId);
    const perfil = getPerfil(negocio.modalidad);

    const hoy = inicioDeHoyUTC();
    const inicioMes = inicioDeMesUTC();
    const diasDelMes = diasEnMesActual();
    const rangoDesde = sumarDias(hoy, -30);
    const rangoHasta = sumarDias(hoy, 90);

    const eventos: EventoCalendar[] = await chequearDisponibilidad({
      calendarId,
      fechaInicioISO: rangoDesde.toISOString(),
      fechaFinISO: rangoHasta.toISOString(),
    });

    // Solo eventos que corresponden a una unidad física conocida de este
    // negocio (evita contar eventos ajenos que compartan el mismo Calendar).
    const eventosNegocio = eventos.filter(
      (e) => e.unidad && negocio.unidadesFisicas.includes(e.unidad)
    );

    const manana = sumarDias(hoy, 1);
    const en7dias = sumarDias(hoy, 7);

    const unidadesOcupadasHoy = new Set(
      eventosNegocio
        .filter((e) => solapa(new Date(e.start), new Date(e.end), hoy, manana))
        .map((e) => e.unidad)
    ).size;

    const checkinsEsteMes = eventosNegocio.filter((e) => {
      const inicio = new Date(e.start);
      return inicio >= inicioMes && inicio < sumarDias(inicioMes, diasDelMes);
    }).length;

    const proximosCheckins7d = eventosNegocio.filter((e) => {
      const inicio = new Date(e.start);
      return inicio >= hoy && inicio < en7dias;
    }).length;

    // Ocupación promedio del mes: noches-unidad reservadas este mes / noches-unidad disponibles este mes.
    let nochesReservadasMes = 0;
    for (const e of eventosNegocio) {
      const inicio = new Date(e.start);
      const fin = new Date(e.end);
      const desde = inicio < inicioMes ? inicioMes : inicio;
      const finMes = sumarDias(inicioMes, diasDelMes);
      const hasta = fin > finMes ? finMes : fin;
      const noches = Math.max(0, Math.round((hasta.getTime() - desde.getTime()) / 86400000));
      nochesReservadasMes += noches;
    }
    const nochesDisponiblesMes = negocio.unidadesFisicas.length * diasDelMes;
    const ocupacionPromedio = nochesDisponiblesMes > 0
      ? Math.round((nochesReservadasMes / nochesDisponiblesMes) * 100)
      : 0;

    const stats = [
      {
        ic: "🏡",
        bg: "#F0F9FF",
        label: `${perfil.nombreUnidadPlural} ocupadas hoy`,
        val: `${unidadesOcupadasHoy} / ${negocio.unidadesFisicas.length}`,
        trend: `${Math.round((unidadesOcupadasHoy / negocio.unidadesFisicas.length) * 100)}%`,
        trendType: "up",
      },
      {
        ic: "📅",
        bg: "#ECFDF5",
        label: "Check-ins este mes",
        val: String(checkinsEsteMes),
        trend: "real",
        trendType: "up",
      },
      {
        ic: "⏳",
        bg: "#FFFBEB",
        label: "Próximos check-ins (7 días)",
        val: String(proximosCheckins7d),
        trend: proximosCheckins7d > 0 ? "atención" : "tranquilo",
        trendType: proximosCheckins7d > 0 ? "warn" : "up",
      },
      {
        ic: "📊",
        bg: "#F0F9FF",
        label: "Ocupación promedio del mes",
        val: `${ocupacionPromedio}%`,
        trend: "real",
        trendType: "up",
      },
    ];

    const reservas = eventosNegocio
      .filter((e) => new Date(e.end) >= hoy)
      .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())
      .slice(0, 8)
      .map((e) => {
        const personas = parsearPersonas(e.descripcion);
        const upsell = parsearUpsell(e.descripcion);
        return {
          n: e.emailHuesped ?? "Huésped",
          init: iniciales(e.emailHuesped),
          u: e.unidad ?? "—",
          f: formatearRango(e.start, e.end) + (personas ? ` · ${personas} pers.` : ""),
          up: upsell ?? "—",
          estado: "ok",
        };
      });

    const occ = negocio.unidadesFisicas.map((unidad) => {
      let noches = 0;
      for (const e of eventosNegocio.filter((ev) => ev.unidad === unidad)) {
        const inicio = new Date(e.start);
        const fin = new Date(e.end);
        const desde = inicio < inicioMes ? inicioMes : inicio;
        const finMes = sumarDias(inicioMes, diasDelMes);
        const hasta = fin > finMes ? finMes : fin;
        noches += Math.max(0, Math.round((hasta.getTime() - desde.getTime()) / 86400000));
      }
      return { l: unidad, p: Math.min(100, Math.round((noches / diasDelMes) * 100)) };
    });

    return new Response(
      JSON.stringify({
        fuente: "real",
        negocio: negocio.nombre,
        unidad: perfil.nombreUnidad,
        unidadPl: perfil.nombreUnidadPlural,
        stats,
        reservas,
        occ,
        upsellTxt: `Catálogo de upsell configurado: ${perfil.catalogoUpsell.join(", ")}.`,
        cobroTxt:
          "El link de cobro se genera vía MercadoPago Checkout Pro (Agente de Cobro). Este panel no muestra montos cobrados: todavía no hay un webhook que confirme el pago de vuelta al sistema.",
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
  path: "/api/panel-datos",
};
