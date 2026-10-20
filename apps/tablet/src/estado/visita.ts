import {
  LARGO_MAX_ATENDIO,
  LARGO_MAX_DIRECCION,
  LARGO_MAX_OBSERVACIONES_VISITA,
  type DatosRegistroVisita,
} from '@/datos/repositorios/visitas';
import type { MotivoVisita, Visita } from '@/datos/tipos';

import { esCoordenadaValida } from './coordenada';
import { motivoDeRechazo, type EstadoPastilla, type EstadoSubida } from './ruta-del-dia';

/**
 * Lo que decide la pantalla "Visita sin venta" (T-39, D7), sin React: la tablet
 * no tiene pruebas de pantalla, asi que toda la validacion vive aqui y la
 * pantalla solo la pinta (mismo criterio que `ruta-del-dia.ts`).
 */

/** En que va la ubicacion de la pantalla. `fallo` cubre permiso negado y sin senal/tiempo agotado. */
export type UbicacionVisita =
  | { estado: 'buscando' }
  | { estado: 'ok'; lat: number; lng: number; precisionM: number | null }
  | { estado: 'fallo'; permisoNegado: boolean };

/** Lo que el vendedor lleva capturado, tal cual (los textos sin recortar). */
export interface EntradaVisita {
  motivo: Pick<MotivoVisita, 'id' | 'exige_foto' | 'exige_atendio'> | null;
  observaciones: string;
  atendio: string;
  fotoUri: string | null;
  ubicacion: UbicacionVisita;
  direccionTexto: string;
}

export interface ValidacionVisita {
  /** Lo que falta, en el orden de la pantalla. Vacio = se puede guardar. */
  faltantes: string[];
  /** El motivo exige el nombre de quien atendio. */
  atendioObligatorio: boolean;
  /** El motivo exige foto. */
  fotoObligatoria: boolean;
  /**
   * Se ve el campo "Dirección o referencia": sin GPS, o si ya se escribio algo
   * (para que no desaparezca si el GPS llega despues; se guardan las dos cosas).
   */
  pedirDireccion: boolean;
  /** Lista para `visitas.registrar` (sin vendedor ni cliente), o `null` si falta algo. */
  visita: Omit<DatosRegistroVisita, 'vendedorId' | 'clienteId'> | null;
}

function limpio(texto: string): string | null {
  const t = texto.trim();
  return t === '' ? null : t;
}

/**
 * La validacion entera de la visita. Pura: misma entrada, misma salida. Los largos se miden con
 * `String.length` (unidades UTF-16), igual que `datos-visita.ts` del backend.
 */
export function validarVisita(e: EntradaVisita): ValidacionVisita {
  const faltantes: string[] = [];
  const atendioObligatorio = e.motivo?.exige_atendio === 1;
  const fotoObligatoria = e.motivo?.exige_foto === 1;
  const observaciones = limpio(e.observaciones);
  const atendio = limpio(e.atendio);
  const direccion = limpio(e.direccionTexto);
  const u = e.ubicacion;
  // El repositorio no revisa el rango: lo hace esta funcion. Una coordenada invalida (NaN, fuera
  // de rango) es "sin GPS": nunca bloquea si hay direccion, y sin ella se pide como en `fallo`.
  // La regla es la misma del alta de prospecto (T-72): `esCoordenadaValida`.
  const gps = u.estado === 'ok' && esCoordenadaValida(u.lat, u.lng) ? u : null;
  // El servidor exige precision >= 0: una negativa o no finita se descarta, la coordenada se queda.
  const precisionM =
    gps !== null && gps.precisionM !== null && Number.isFinite(gps.precisionM) && gps.precisionM >= 0
      ? gps.precisionM
      : null;
  const pedirDireccion = u.estado === 'fallo' || (u.estado === 'ok' && gps === null) || direccion !== null;

  if (e.motivo === null) faltantes.push('Elige el motivo de la visita.');
  if (observaciones !== null && observaciones.length > LARGO_MAX_OBSERVACIONES_VISITA) {
    faltantes.push(`Las observaciones no pueden pasar de ${LARGO_MAX_OBSERVACIONES_VISITA} caracteres.`);
  }
  if (atendioObligatorio && atendio === null) faltantes.push('Escribe el nombre de quien atendió.');
  if (atendio !== null && atendio.length > LARGO_MAX_ATENDIO) {
    faltantes.push(`El nombre de quien atendió no puede pasar de ${LARGO_MAX_ATENDIO} caracteres.`);
  }
  if (fotoObligatoria && e.fotoUri === null) {
    faltantes.push('Este motivo exige una foto: tómala antes de guardar.');
  }
  if (direccion !== null && direccion.length > LARGO_MAX_DIRECCION) {
    faltantes.push(`La dirección no puede pasar de ${LARGO_MAX_DIRECCION} caracteres.`);
  }
  if (gps === null && direccion === null) {
    faltantes.push(
      u.estado === 'buscando'
        ? 'Esperando la ubicación…'
        : 'Sin GPS: escribe la dirección o una referencia del lugar.',
    );
  }

  return {
    faltantes,
    atendioObligatorio,
    fotoObligatoria,
    pedirDireccion,
    visita:
      faltantes.length === 0 && e.motivo !== null
        ? {
            motivoVisitaId: e.motivo.id,
            observaciones,
            atendio,
            lat: gps?.lat ?? null,
            lng: gps?.lng ?? null,
            precisionM,
            direccionTexto: direccion,
            fotoUri: e.fotoUri,
          }
        : null,
  };
}

/** El estado de la ubicacion en palabras (D7). */
export function textoUbicacionVisita(u: UbicacionVisita): string {
  switch (u.estado) {
    case 'buscando':
      return 'Buscando ubicación…';
    case 'ok':
      return u.precisionM === null ? 'Ubicación tomada' : `Ubicación tomada (±${Math.round(u.precisionM)} m)`;
    case 'fallo':
      return 'No se pudo obtener la ubicación';
  }
}

/** La pastilla de UNA visita en la ficha ("Visitas de hoy"). */
export function pastillaVisita(
  v: Pick<Visita, 'sync_estado' | 'sync_error'>,
): { texto: string; estado: EstadoPastilla; detalle: string | null } {
  switch (v.sync_estado) {
    case 'pendiente':
    case 'enviando':
      return { texto: 'por subir', estado: 'pendiente', detalle: null };
    case 'sincronizado':
      return { texto: 'subida', estado: 'listo', detalle: null };
    case 'error':
      return { texto: 'rechazada', estado: 'error', detalle: motivoDeRechazo(v.sync_error) };
  }
}

/** La palabra del estado agregado de las visitas de un cliente ("Visitados sin venta"). */
export function textoEstadoVisitas(e: EstadoSubida): string {
  return { error: 'rechazada', pendiente: 'por subir', listo: 'subida' }[e];
}
