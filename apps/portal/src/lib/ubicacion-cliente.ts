import type { OrigenUbicacion } from "./clientes";

/** Las etiquetas del spec (D6), exactas. */
const TEXTO_ORIGEN: Record<OrigenUbicacion, string> = {
  gps: "GPS de la tablet",
  geocodificada: "Ubicada por Google",
  manual: "Capturada a mano",
};

/** La coordenada guardada (o la que acaba de dar Google) y su origen. */
export interface UbicacionReferencia {
  lat: number | null;
  lng: number | null;
  origen: OrigenUbicacion | null;
}

/**
 * La etiqueta junto a Latitud y Longitud (T-72, D6).
 *
 * Mira los CAMPOS del formulario, no solo lo guardado: si la oficina cambia la
 * coordenada, lo que se va a guardar es una captura a mano, y el servidor la
 * marcará así (`origenAlGuardar`). Si los campos siguen igual que la
 * referencia, conserva su origen.
 */
export function etiquetaOrigenUbicacion(
  latTexto: string,
  lngTexto: string,
  referencia: UbicacionReferencia,
): string {
  if (latTexto.trim() === "" && lngTexto.trim() === "") return "Sin ubicación";
  const igual =
    referencia.origen !== null &&
    referencia.lat === Number(latTexto) &&
    referencia.lng === Number(lngTexto);
  return igual && referencia.origen !== null
    ? TEXTO_ORIGEN[referencia.origen]
    : TEXTO_ORIGEN.manual;
}

/**
 * El botón "Ubicar con la dirección" aparece si no hay coordenada y el cliente
 * tiene domicilio GUARDADO (es el que geocodifica el servidor).
 */
export function muestraBotonUbicar(
  latTexto: string,
  lngTexto: string,
  domicilioGuardado: string | null,
): boolean {
  return (
    latTexto.trim() === "" &&
    lngTexto.trim() === "" &&
    (domicilioGuardado ?? "").trim() !== ""
  );
}
