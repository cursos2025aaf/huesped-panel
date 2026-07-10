// netlify/functions/lib/negocios.mts
//
// Inventario de unidades físicas por negocio, para el mapa de unidades
// (ver composio-client.mts: buscarUnidadLibre). Por ahora es una config
// hardcodeada — cuando exista un formulario/DB de alta de negocios, esto
// pasa a completarse desde ahí en vez de estar en código.

import type { Modalidad, TimingCobro } from "./perfiles.mts";
import { getPerfil } from "./perfiles.mts";

// Política de cobro de un negocio puntual. El perfil de modalidad (ver
// perfiles.mts) define un DEFAULT razonable según el rubro (ej. hostería
// suele cobrar el 100% anticipado, cabañas suele pedir seña + saldo), pero
// la decisión final es del dueño del negocio, no del rubro: cualquier
// negocio puede elegir cobrar seña + saldo O el 100% anticipado, con el
// porcentaje de seña que quiera. Si un negocio no define configuracionCobro,
// se usa el default de su modalidad.
export interface ConfiguracionCobro {
  timing: TimingCobro; // "anticipado_total" | "senal_mas_saldo" | "en_el_lugar"
  porcentajeSenal: number; // se ignora si timing es "anticipado_total"
}

export interface NegocioConfig {
  nombre: string;
  modalidad: Modalidad;
  // Nombres de cada unidad física reservable (cabaña, carpa, sitio, etc.),
  // en el mismo orden en que se ofrecen al buscar una libre.
  unidadesFisicas: string[];
  // Opcional: si el negocio quiere una política de cobro distinta a la
  // default de su modalidad. Ver ConfiguracionCobro arriba.
  configuracionCobro?: ConfiguracionCobro;
}

export const NEGOCIOS: Record<string, NegocioConfig> = {
  "los-alerces": {
    nombre: "Complejo Los Alerces",
    modalidad: "cabanas",
    unidadesFisicas: Array.from({ length: 12 }, (_, i) => `Cabaña ${i + 1}`),
    // Sin configuracionCobro: usa el default de "cabanas" (seña 40% + saldo).
  },
};

export function getNegocio(negocioId: string): NegocioConfig {
  const negocio = NEGOCIOS[negocioId];
  if (!negocio) {
    throw new Error(
      `Negocio "${negocioId}" no está configurado en negocios.mts. Negocios disponibles: ${Object.keys(NEGOCIOS).join(", ")}`
    );
  }
  return negocio;
}

export function getUnidadesFisicas(negocioId: string): string[] {
  return getNegocio(negocioId).unidadesFisicas;
}

// Devuelve la política de cobro efectiva de un negocio: la suya propia si
// la definió, o si no la default de su modalidad.
export function getConfiguracionCobro(negocioId: string): ConfiguracionCobro {
  const negocio = getNegocio(negocioId);
  if (negocio.configuracionCobro) {
    return negocio.configuracionCobro;
  }
  const perfil = getPerfil(negocio.modalidad);
  return {
    timing: perfil.cobro.timing,
    porcentajeSenal: perfil.cobro.porcentajeSenal,
  };
}
