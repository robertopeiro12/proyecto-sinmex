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

/**
 * ¿El campo Domicilio es distinto del GUARDADO? Entonces "Ubicar con la
 * dirección" geocodificaría el viejo, y su coordenada quedaría junto al domicilio
 * nuevo como "Ubicada por Google": el botón se deshabilita hasta guardar (y
 * guardar ya intenta ubicar el domicilio nuevo en segundo plano).
 */
export function domicilioSinGuardar(campo: string, guardado: string | null): boolean {
  return campo.trim() !== (guardado ?? "").trim();
}

/** Los campos Latitud y Longitud, tal cual. */
export interface CamposCoordenada {
  lat: string;
  lng: string;
}

/**
 * La coordenada que manda el formulario al guardar (T-72). Va en pareja: el
 * servidor decide con las dos.
 *
 * - Alta (`cargados` es `null`): el número, u omitida si el campo está vacío.
 * - Edición sin cambios en los campos: se omite y el servidor conserva la que
 *   tenga. Así un formulario abierto antes de que Google respondiera no borra
 *   la coordenada que llegó mientras.
 * - Edición con cambios: el número, o `null` para borrarla.
 */
export function coordenadaAEnviar(
  campos: CamposCoordenada,
  cargados: CamposCoordenada | null,
): { lat?: number | null; lng?: number | null } {
  const numero = (texto: string) => (texto.trim() === "" ? null : Number(texto));
  if (cargados === null) {
    return { lat: numero(campos.lat) ?? undefined, lng: numero(campos.lng) ?? undefined };
  }
  if (campos.lat === cargados.lat && campos.lng === cargados.lng) return {};
  return { lat: numero(campos.lat), lng: numero(campos.lng) };
}
