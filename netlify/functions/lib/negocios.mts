// netlify/functions/lib/negocios.mts
//
// Inventario de unidades físicas por negocio, para el mapa de unidades
// (ver composio-client.mts: buscarUnidadLibre). Por ahora es una config
// hardcodeada — cuando exista un formulario/DB de alta de negocios, esto
// pasa a completarse desde ahí en vez de estar en código.

import type { Modalidad } from "./perfiles.mts";

export interface NegocioConfig {
  nombre: string;
  modalidad: Modalidad;
  // Nombres de cada unidad física reservable (cabaña, carpa, sitio, etc.),
  // en el mismo orden en que se ofrecen al buscar una libre.
  unidadesFisicas: string[];
}

export const NEGOCIOS: Record<string, NegocioConfig> = {
  "los-alerces": {
    nombre: "Complejo Los Alerces",
    modalidad: "cabanas",
    unidadesFisicas: Array.from({ length: 12 }, (_, i) => `Cabaña ${i + 1}`),
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
