import { faltantesDeVenta, textoFaltante, type Existencia } from '@/datos/inventario-reglas';
import type { Booleano, EstadoCarga, FechaISO } from '@/datos/tipos';
import type { ResultadoApiCarga } from '@/sincronizacion/api-carga';
import type { CargaPull, CuerpoRespuestaCarga } from '@/sincronizacion/contrato';

/**
 * Inventario del vendedor en las pantallas (T-27 pieza 1), sin React: las
 * reglas de la capa de datos (reexportadas, son las mismas que usa
 * `ventas.registrar`) mas lo que solo es de pantalla: la respuesta a una carga
 * con su guardia de doble toque, los textos y los faltantes de la revision.
 */
export {
  bloqueoDeVenta,
  cargaPendiente,
  existencias,
  faltantesDeVenta,
  MOTIVO_CARGA_PENDIENTE,
  textoFaltante,
} from '@/datos/inventario-reglas';
export type {
  CargaInventario,
  Existencia,
  Faltante,
  LineaVentaInventario,
  PiezasDePresentacion,
} from '@/datos/inventario-reglas';

/** El mismo 300 del servidor (`reglas-carga.ts`) y del check de `carga.motivo_rechazo`. */
export const LARGO_MAX_MOTIVO_RECHAZO = 300;

export const MENSAJE_SIN_RED_CARGA = 'Conéctate al WiFi para aceptar la carga.';
export const MENSAJE_CARGA_CAMBIO = 'La carga cambió en el almacén; revísala de nuevo.';
export const MENSAJE_CARGA_ELIMINADA = 'El almacén eliminó esta carga.';
export const MENSAJE_SESION_CARGA =
  'Tu sesión ya no vale. Vuelve a entrar con el WiFi del negocio.';
export const NOTA_CONTROL_APAGADO = 'El control de inventario de tu sucursal está apagado';

export type AccionCarga = 'aceptar' | 'rechazar';

/** Errores de forma de la respuesta (D2: rechazar lleva motivo). */
export function validarRespuesta(accion: AccionCarga, motivo: string): string[] {
  if (accion === 'aceptar') return [];
  const texto = motivo.trim();
  if (texto === '') return ['Escribe por qué rechazas la carga.'];
  if (texto.length > LARGO_MAX_MOTIVO_RECHAZO) {
    return [`El motivo lleva hasta ${LARGO_MAX_MOTIVO_RECHAZO} caracteres.`];
  }
  return [];
}

/**
 * El cuerpo del endpoint. `version` es la de la carga QUE SE PINTO: si el
 * portal la cambio, el servidor contesta 409 y el vendedor nunca acepta lo que
 * no vio (Review Focus 2).
 */
export function cuerpoRespuesta(
  accion: AccionCarga,
  motivo: string,
  version: number,
): CuerpoRespuestaCarga {
  return accion === 'aceptar'
    ? { version, accion }
    : { version, accion, motivo: motivo.trim() };
}

/** Aceptar/Rechazar solo en una carga pendiente, viva y de hoy. */
export function puedeResponder(
  carga: { estado: EstadoCarga; activo: Booleano; fecha: FechaISO },
  hoy: FechaISO,
): boolean {
  return carga.estado === 'pendiente' && carga.activo === 1 && carga.fecha === hoy;
}

/** Subconjunto de `Estado` de `@/ui/pantalla` (un .tsx no corre en Jest). */
export function pastillaCarga(estado: EstadoCarga): {
  texto: string;
  estado: 'pendiente' | 'listo' | 'error';
} {
  if (estado === 'aceptada') return { texto: 'Aceptada', estado: 'listo' };
  if (estado === 'rechazada') return { texto: 'Rechazada', estado: 'error' };
  return { texto: 'Por aceptar', estado: 'pendiente' };
}

export function totalPiezas(lineas: readonly { piezas: number }[]): number {
  return lineas.reduce((total, l) => total + l.piezas, 0);
}

/**
 * "Te quedan N" bajo cada presentacion de la venta: la existencia menos lo que
 * ya va en esta captura (vendido + regalado). Si no alcanza, dice cuanto falta.
 */
export function textoTeQuedan(
  existencia: number,
  enEstaVenta: number,
): { texto: string; falta: boolean } {
  const quedan = existencia - enEstaVenta;
  if (quedan >= 0) return { texto: `Te quedan ${quedan}`, falta: false };
  const faltan = -quedan;
  return { texto: faltan === 1 ? 'Falta 1 pieza' : `Faltan ${faltan} piezas`, falta: true };
}

/**
 * Los faltantes de la captura como textos para la revision ("Horchata 1 L:
 * faltan 3 piezas"). La pantalla los calcula al tocar "Revisar" y los congela
 * (no se recalculan con la firma a medias); `ventas.registrar` vuelve a
 * comprobar al grabar. Un regalo sin presentacion elegida no cuenta todavia.
 */
export function faltantesDeCaptura({
  controlInventario,
  existencias: disponibles,
  lineas,
  regalos,
}: {
  controlInventario: boolean;
  existencias: ReadonlyMap<string, Existencia>;
  lineas: readonly { presentacionId: string; etiqueta: string; cantidad: number }[];
  regalos: readonly { presentacionId: string | null; cantidad: number }[];
}): string[] {
  const etiquetas = new Map(lineas.map((l) => [l.presentacionId, l.etiqueta] as const));
  return faltantesDeVenta({
    controlInventario,
    existencias: disponibles,
    lineas: lineas.map((l) => ({ presentacionId: l.presentacionId, cantidad: l.cantidad })),
    regalos: regalos.flatMap((r) =>
      r.presentacionId === null ? [] : [{ presentacionId: r.presentacionId, cantidad: r.cantidad }],
    ),
  }).map((f) => textoFaltante(etiquetas.get(f.presentacionId) ?? 'Un producto', f.faltan));
}

/** Los pasos de responder, inyectados para probar el orden y la guardia sin pantalla. */
export interface PasosRespuestaCarga {
  /** Llama al servidor. Lanza si no hay red. */
  responder(): Promise<ResultadoApiCarga>;
  /** Escribe en la `carga` local la carga que contesto el servidor. */
  aplicar(carga: CargaPull): void;
  /** La sincronizacion normal (pull + push; renueva la sesion como primer paso). */
  sincronizar(): Promise<unknown>;
}

export type ResultadoRespuestaCarga =
  | { estado: 'respondida'; carga: CargaPull }
  | { estado: 'cambio' | 'eliminada' | 'sin-red' | 'invalida' | 'sin-sesion'; mensaje: string };

export interface RespondedorCarga {
  /** `null` = se ignoro: ya hay una respuesta en curso (o ya se respondio). */
  responder(pasos: PasosRespuestaCarga): Promise<ResultadoRespuestaCarga | null>;
}

/** Una sincronizacion que falla no cambia lo que se le dice al vendedor. */
async function sincronizarSinFallar(pasos: PasosRespuestaCarga): Promise<void> {
  try {
    await pasos.sincronizar();
  } catch {
    // Sin red o sin sesion: la pantalla ya tiene su mensaje.
  }
}

async function intentar(pasos: PasosRespuestaCarga): Promise<ResultadoRespuestaCarga> {
  let resultado: ResultadoApiCarga;
  try {
    resultado = await pasos.responder();
    if (resultado.tipo === 'sesion') {
      // El token de acceso vencio: la sincronizacion lo renueva por su camino
      // normal (nunca se renueva desde aqui) y se reintenta una sola vez.
      await sincronizarSinFallar(pasos);
      resultado = await pasos.responder();
    }
  } catch {
    return { estado: 'sin-red', mensaje: MENSAJE_SIN_RED_CARGA };
  }

  switch (resultado.tipo) {
    case 'ok':
      pasos.aplicar(resultado.carga);
      return { estado: 'respondida', carga: resultado.carga };
    case 'cambio':
      if (resultado.carga) pasos.aplicar(resultado.carga);
      await sincronizarSinFallar(pasos);
      return { estado: 'cambio', mensaje: MENSAJE_CARGA_CAMBIO };
    case 'inexistente':
      await sincronizarSinFallar(pasos);
      return { estado: 'eliminada', mensaje: MENSAJE_CARGA_ELIMINADA };
    case 'invalida':
      return { estado: 'invalida', mensaje: resultado.mensaje };
    case 'sesion':
      return { estado: 'sin-sesion', mensaje: MENSAJE_SESION_CARGA };
  }
}

/**
 * Responder una carga con la **guardia de doble toque** dentro: la llamada es
 * asincrona y con red lenta un segundo toque no debe mandar otra respuesta
 * (Review Focus 3; el servidor ademas es idempotente). El candado se suelta si
 * algo impidio responder (para reintentar); tras responder se queda cerrado.
 * Se suelta en un `finally`: si un paso truena (escribir la carga en la base
 * local, por ejemplo) el error sale, pero el boton no se queda muerto; reenviar
 * la misma respuesta es seguro porque el servidor es idempotente.
 * La pantalla lo guarda en un `useRef`.
 */
export function crearRespondedorCarga(): RespondedorCarga {
  let cerrado = false;
  return {
    async responder(pasos) {
      if (cerrado) return null;
      cerrado = true;
      let respondida = false;
      try {
        const resultado = await intentar(pasos);
        respondida = resultado.estado === 'respondida';
        return resultado;
      } finally {
        if (!respondida) cerrado = false;
      }
    },
  };
}
