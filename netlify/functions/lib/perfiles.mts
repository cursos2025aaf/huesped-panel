// netlify/functions/lib/perfiles.mts
//
// Perfiles de modalidad de HuésPED. Cada perfil define las 4 variables que
// separan el "motor" (Agente A + Agente B) de la configuración específica
// del rubro del cliente: unidad de reserva, granularidad temporal, lógica
// de cobro y catálogo de upsell. Ver BRIEFING_HuesPED_Sistema_Multiagente_Reservas.md
// para el detalle de la investigación de mercado detrás de estos valores.

export type Modalidad = "balneario" | "camping" | "cabanas" | "hosteria";

export type TimingCobro = "anticipado_total" | "senal_mas_saldo" | "en_el_lugar";
export type Granularidad = "dia" | "noche" | "franja_horaria";
export type MedioPago = "mercadopago" | "efectivo";

export interface PerfilModalidad {
  modalidad: Modalidad;
  nombreUnidad: string;
  nombreUnidadPlural: string;
  esUnidadFisicaFija: boolean;
  permiteReasignarUnidad: boolean;
  granularidad: Granularidad;
  minimoReserva: number;
  cobro: {
    timing: TimingCobro;
    porcentajeSenal: number;
    medios: MedioPago[];
  };
  catalogoUpsell: string[];
  canalPreferido: string[];
}

export const PERFILES: Record<Modalidad, PerfilModalidad> = {
  balneario: {
    modalidad: "balneario",
    nombreUnidad: "carpa",
    nombreUnidadPlural: "carpas",
    esUnidadFisicaFija: true,
    permiteReasignarUnidad: true,
    granularidad: "dia",
    minimoReserva: 1,
    cobro: {
      timing: "senal_mas_saldo",
      porcentajeSenal: 30,
      medios: ["mercadopago", "efectivo"],
    },
    catalogoUpsell: ["reposera extra", "sombrilla adicional", "servicio de parador"],
    canalPreferido: ["whatsapp", "web"],
  },
  camping: {
    modalidad: "camping",
    nombreUnidad: "sitio",
    nombreUnidadPlural: "sitios",
    esUnidadFisicaFija: true,
    permiteReasignarUnidad: false,
    granularidad: "noche",
    minimoReserva: 1,
    cobro: {
      timing: "senal_mas_saldo",
      porcentajeSenal: 30,
      medios: ["mercadopago"],
    },
    catalogoUpsell: ["leña", "alquiler de carpa", "kayak", "pileta"],
    canalPreferido: ["whatsapp", "email"],
  },
  cabanas: {
    modalidad: "cabanas",
    nombreUnidad: "cabaña",
    nombreUnidadPlural: "cabañas",
    esUnidadFisicaFija: true,
    permiteReasignarUnidad: false,
    granularidad: "noche",
    minimoReserva: 2,
    cobro: {
      timing: "senal_mas_saldo",
      porcentajeSenal: 40,
      medios: ["mercadopago"],
    },
    catalogoUpsell: ["desayuno", "cochera", "kit de pesca", "kit de mate"],
    canalPreferido: ["whatsapp", "email"],
  },
  hosteria: {
    modalidad: "hosteria",
    nombreUnidad: "habitación",
    nombreUnidadPlural: "habitaciones",
    esUnidadFisicaFija: true,
    permiteReasignarUnidad: false,
    granularidad: "noche",
    minimoReserva: 1,
    cobro: {
      timing: "anticipado_total",
      porcentajeSenal: 100,
      medios: ["mercadopago"],
    },
    catalogoUpsell: ["media pensión", "traslado al aeropuerto", "excursión"],
    canalPreferido: ["email", "web"],
  },
};

export function getPerfil(modalidad: Modalidad): PerfilModalidad {
  const perfil = PERFILES[modalidad];
  if (!perfil) {
    throw new Error(`Modalidad desconocida: ${modalidad}`);
  }
  return perfil;
}
