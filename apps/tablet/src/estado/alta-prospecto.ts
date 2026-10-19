import { LARGO_MAX_DOMICILIO } from '@/datos/repositorios/prospectos';
import type { ResultadoUbicacion } from '@/ubicacion/obtener';

import { esCoordenadaValida } from './coordenada';

/**
 * Lo que decide la pantalla "Prospectos" (T-72, D1), sin React: la tablet no
 * tiene pruebas de pantalla, asi que la regla vive aqui y la pantalla solo la
 * pinta (mismo criterio que `visita.ts`).
 */

/** La etiqueta del campo es siempre esta; si es obligatorio o no va en la ayuda. */
export const ETIQUETA_DOMICILIO = 'Dirección del negocio';

/** Ayuda (`ayuda` de Campo) de la direccion segun si es obligatoria (D1). */
export function ayudaDomicilio(obligatorio: boolean): string {
  return obligatorio ? 'Obligatoria sin GPS.' : 'Opcional.';
}

/**
 * En que va la ubicacion del alta. `sin-tomar` es el estado inicial: el
 * vendedor todavia no toco "Usar mi ubicación", y eso tambien es "sin GPS".
 */
export type UbicacionAlta =
  | { estado: 'sin-tomar' }
  | { estado: 'buscando' }
  | { estado: 'ok'; lat: number; lng: number }
  | { estado: 'fallo'; permisoNegado: boolean };

/** Lo que el vendedor lleva capturado, tal cual (los textos sin recortar). */
export interface EntradaAltaProspecto {
  nombre: string;
  telefono: string;
  encargado: string;
  ubicacion: UbicacionAlta;
  /** "Dirección del negocio". */
  domicilio: string;
}

export interface ValidacionAltaProspecto {
  /** Lo que falta, en el orden de la pantalla. Vacio = se puede guardar. */
  faltantes: string[];
  /** Sin coordenada valida, la direccion es obligatoria (D1). */
  domicilioObligatorio: boolean;
  /**
   * Lo que va a `prospectos.registrar`: la coordenada si es valida (si no,
   * null) y la direccion recortada (o null). `null` si falta algo.
   */
  ubicacion: { lat: number | null; lng: number | null; domicilio: string | null } | null;
}

function limpio(texto: string): string | null {
  const t = texto.trim();
  return t === '' ? null : t;
}

/**
 * La validacion del alta. Pura: misma entrada, misma salida. Los largos se miden con
 * `String.length`, igual que `datos-prospecto.ts` del backend.
 */
export function validarAltaProspecto(e: EntradaAltaProspecto): ValidacionAltaProspecto {
  const faltantes: string[] = [];
  const u = e.ubicacion;
  // T-39 D7 / T-72 D1: una lectura fuera de rango o no finita es "sin GPS".
  const gps = u.estado === 'ok' && esCoordenadaValida(u.lat, u.lng) ? u : null;
  const domicilio = limpio(e.domicilio);

  if (limpio(e.nombre) === null) faltantes.push('Captura el nombre del negocio.');
  if (limpio(e.telefono) === null) faltantes.push('Captura el teléfono del negocio.');
  if (limpio(e.encargado) === null) faltantes.push('Captura el nombre del encargado.');
  if (domicilio !== null && domicilio.length > LARGO_MAX_DOMICILIO) {
    faltantes.push(`La dirección no puede pasar de ${LARGO_MAX_DOMICILIO} caracteres.`);
  }
  if (gps === null && domicilio === null) {
    faltantes.push(
      u.estado === 'buscando' ? 'Esperando la ubicación…' : 'Sin GPS: escribe la dirección del negocio.',
    );
  }

  return {
    faltantes,
    domicilioObligatorio: gps === null,
    ubicacion:
      faltantes.length === 0 ? { lat: gps?.lat ?? null, lng: gps?.lng ?? null, domicilio } : null,
  };
}

/** El resultado de `obtenerUbicacion` (que nunca lanza) como estado del alta. */
export function ubicacionAltaDe(r: ResultadoUbicacion): UbicacionAlta {
  return r.estado === 'ok'
    ? { estado: 'ok', lat: r.lat, lng: r.lng }
    : { estado: 'fallo', permisoNegado: r.estado === 'permiso-negado' };
}

/**
 * La lectura del GPS que llega cuando el formulario ya es otro. `ubicar()` toma
 * el numero de formulario al pedir la ubicacion y lo compara al recibirla:
 * `guardar()` lo incrementa al limpiar el formulario. Si cambio, la lectura es
 * del negocio anterior y se descarta (`null`); si no, se pinta como de costumbre.
 * Sin esto, un GPS lento cae en el formulario ya limpio y el siguiente
 * prospecto se guarda con la coordenada del negocio anterior.
 */
export function ubicacionRecibida(
  formularioAlPedir: number,
  formularioAhora: number,
  r: ResultadoUbicacion,
): UbicacionAlta | null {
  return formularioAlPedir === formularioAhora ? ubicacionAltaDe(r) : null;
}

/** Que hacer cuando la ubicacion no sirve, en palabras del vendedor; `null` si no hay nada que decir. */
export function avisoUbicacionAlta(u: UbicacionAlta): string | null {
  if (u.estado === 'fallo') {
    return u.permisoNegado
      ? 'Sin permiso de ubicación. Escribe la dirección del negocio para guardarlo; la oficina lo ubicará con ella.'
      : 'No se pudo leer la ubicación (sin señal de GPS). Escribe la dirección del negocio o inténtalo afuera del local.';
  }
  if (u.estado === 'ok' && !esCoordenadaValida(u.lat, u.lng)) {
    return 'El GPS dio una ubicación que no sirve. Escribe la dirección del negocio o vuelve a intentarlo.';
  }
  return null;
}
