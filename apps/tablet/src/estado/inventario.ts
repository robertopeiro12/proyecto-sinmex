import { faltantesDeVenta, renglonAceptado, textoFaltante, type Existencia } from '@/datos/inventario-reglas';
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
  consumoDelDia,
  existencias,
  faltantesDeMovimiento,
  faltantesDeVenta,
  MOTIVO_CARGA_PENDIENTE,
  renglonAceptado,
  textoFaltante,
} from '@/datos/inventario-reglas';
export type {
  CargaInventario,
  Existencia,
  Faltante,
  LineaMovimientoInventario,
  LineaVentaInventario,
  PiezasDePresentacion,
} from '@/datos/inventario-reglas';

export const MENSAJE_SIN_RED_CARGA = 'Conéctate al WiFi para aceptar la carga.';
export const MENSAJE_CARGA_CAMBIO = 'La carga cambió en el almacén; revísala de nuevo.';
export const MENSAJE_CARGA_ELIMINADA = 'El almacén eliminó esta carga.';
export const MENSAJE_SESION_CARGA =
  'Tu sesión ya no vale. Vuelve a entrar con el WiFi del negocio.';
export const NOTA_CONTROL_APAGADO = 'El control de inventario de tu sucursal está apagado';

export type AccionCarga = 'aceptar' | 'rechazar';

/**
 * El cuerpo del endpoint (pieza 3): los `presentacion_id` palomeados; la lista
 * vacia es "Rechazar todo". Sin motivo. `version` es la de la carga QUE SE
 * PINTO: si el portal la cambio, el servidor contesta 409 y el vendedor nunca
 * acepta lo que no vio (Review Focus 2).
 */
export function cuerpoRespuesta(version: number, aceptadas: readonly string[]): CuerpoRespuestaCarga {
  return { version, aceptadas: [...aceptadas] };
}

/** Aceptar/Rechazar solo en una carga pendiente, viva y de hoy. */
export function puedeResponder(
  carga: { estado: EstadoCarga; activo: Booleano; fecha: FechaISO },
  hoy: FechaISO,
): boolean {
  return carga.estado === 'pendiente' && carga.activo === 1 && carga.fecha === hoy;
}

/** Lo que los textos de una carga leen de ella (una `CargaConLineas` sirve tal cual). */
export interface CargaParaTexto {
  estado: EstadoCarga;
  lineas: readonly { aceptada?: 0 | 1 | null }[];
}

/**
 * "Aceptada", "Aceptada 3 de 5" (pieza 3: se acepto una parte), "Rechazada" o
 * "Por aceptar". Cuenta renglones, no piezas. Una aceptada sin ningun renglon
 * aceptado dice "Rechazada", como el candado de la Ruta.
 */
export function textoEstadoCarga(carga: CargaParaTexto): string {
  if (carga.estado === 'pendiente') return 'Por aceptar';
  if (carga.estado === 'rechazada') return 'Rechazada';
  const total = carga.lineas.length;
  const aceptados = carga.lineas.filter((l) => renglonAceptado(carga.estado, l)).length;
  if (total > 0 && aceptados === 0) return 'Rechazada';
  return aceptados === total ? 'Aceptada' : `Aceptada ${aceptados} de ${total}`;
}

/** Subconjunto de `Estado` de `@/ui/pantalla` (un .tsx no corre en Jest). */
export function pastillaCarga(carga: CargaParaTexto): {
  texto: string;
  estado: 'pendiente' | 'listo' | 'error';
} {
  const texto = textoEstadoCarga(carga);
  if (texto === 'Por aceptar') return { texto, estado: 'pendiente' };
  if (texto === 'Rechazada') return { texto, estado: 'error' };
  return { texto, estado: 'listo' };
}

/** El checklist (maqueta 4): prende o apaga un renglon. No toca el conjunto que recibe. */
export function alternarRenglon(seleccion: ReadonlySet<string>, presentacionId: string): Set<string> {
  const nueva = new Set(seleccion);
  if (nueva.has(presentacionId)) nueva.delete(presentacionId);
  else nueva.add(presentacionId);
  return nueva;
}

/** ¿Estan palomeados todos? (con la carga vacia, no). */
export function todosSeleccionados(seleccion: ReadonlySet<string>, ids: readonly string[]): boolean {
  return ids.length > 0 && ids.every((id) => seleccion.has(id));
}

/** "Seleccionar todos": si falta alguno, palomea todos; si ya estan todos, los quita. */
export function seleccionarTodos(seleccion: ReadonlySet<string>, ids: readonly string[]): Set<string> {
  return todosSeleccionados(seleccion, ids) ? new Set() : new Set(ids);
}

/**
 * Lo que se manda: los palomeados en el orden de la carga, y solo los que
 * siguen en ella (tras un 409 la carga pudo cambiar de renglones: un id que ya
 * no esta seria un 400).
 */
export function aceptadasDe(
  lineas: readonly { presentacion_id: string }[],
  seleccion: ReadonlySet<string>,
): string[] {
  return lineas.map((l) => l.presentacion_id).filter((id) => seleccion.has(id));
}

/** El boton del checklist: "Aceptar 6 de 8". */
export function textoAceptar(palomeados: number, total: number): string {
  return `Aceptar ${palomeados} de ${total}`;
}

/** El aviso de arriba del resumen (maqueta 5). */
export function tituloAvisoCarga(carga: { numero: number }): string {
  return carga.numero > 1 ? 'Recarga esperando' : 'Carga por aceptar';
}

/** Lo que de un cambio recibe y entrega el vendedor, por presentacion. */
interface FilaConCambios {
  cargado: number;
  existencia: number;
  cambiosRecibidos?: number;
  cambiosEntregados?: number;
}

/** Cambios netos del resumen: lo que recibio de los clientes menos lo que entrego. */
export function cambiosNetos(fila: Pick<FilaConCambios, 'cambiosRecibidos' | 'cambiosEntregados'>): number {
  return (fila.cambiosRecibidos ?? 0) - (fila.cambiosEntregados ?? 0);
}

/** "+3", "−2" o "0" (con el signo menos tipografico): la columna Cambios. */
export function textoCambios(neto: number): string {
  if (neto > 0) return `+${neto}`;
  if (neto < 0) return `−${-neto}`;
  return '0';
}

/**
 * "Salió" del resumen: vendido + regalado + mermas + consumo, sin los cambios:
 * cargado − existencia + cambios netos. Asi Cargado − Salió + Cambios =
 * Existencia aunque un cambio reciba mas de lo que entrega (rediseño pieza 4).
 * Nunca negativo.
 */
export function salio(fila: FilaConCambios): number {
  return Math.max(0, fila.cargado - fila.existencia + cambiosNetos(fila));
}

export function totalPiezas(lineas: readonly { piezas: number }[]): number {
  return lineas.reduce((total, l) => total + l.piezas, 0);
}

/** "pieza" con 1, "piezas" con cualquier otro numero (recorrido final, N2). */
export function palabraPiezas(n: number): string {
  return n === 1 ? 'pieza' : 'piezas';
}

/**
 * La etiqueta de una presentacion para una columna angosta (recorrido final,
 * D3): pega el volumen a su unidad con un espacio duro ("1\u00A0L",
 * "500\u00A0ml"), asi el renglon se parte entre producto y volumen y nunca deja
 * la unidad sola abajo ("Horchata 1 / L").
 */
export function etiquetaSinCortarVolumen(etiqueta: string): string {
  return etiqueta.replace(/(\d) (\S+)$/, '$1\u00A0$2');
}

/**
 * Las piezas que se muestran de una carga (recorrido final, D6): ya aceptada,
 * solo los renglones que entraron (`renglonAceptado`); pendiente o rechazada,
 * todo lo que mando el almacen.
 */
export function piezasDeCarga(carga: {
  estado: EstadoCarga;
  lineas: readonly { piezas: number; aceptada?: 0 | 1 | null }[];
}): number {
  if (carga.estado !== 'aceptada') return totalPiezas(carga.lineas);
  return totalPiezas(carga.lineas.filter((l) => renglonAceptado(carga.estado, l)));
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
  if (quedan >= 0) return { texto: `Te ${quedan === 1 ? 'queda' : 'quedan'} ${quedan}`, falta: false };
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

/**
 * "Por regresar a la planta" (T-27 pieza 2): por presentacion, las piezas buenas
 * (la existencia; una negativa —registrada con el control apagado— cuenta 0) y la
 * merma (recibida del cliente + del trayecto). Sin nada que regresar, no sale.
 */
export function filasPorRegresar<
  F extends { presentacionId: string; etiqueta: string; existencia: number; mermaPorRegresar: number },
>(filas: readonly F[]): { presentacionId: string; etiqueta: string; buenas: number; merma: number }[] {
  return filas
    .map((f) => ({
      presentacionId: f.presentacionId,
      etiqueta: f.etiqueta,
      buenas: Math.max(0, f.existencia),
      merma: f.mermaPorRegresar,
    }))
    .filter((f) => f.buenas > 0 || f.merma > 0);
}
