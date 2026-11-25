import {
  llevaCliente,
  MAX_PIEZAS_MOVIMIENTO,
  motivoDeConsumo,
  validarMovimiento,
  type LineaMovimiento,
} from '@/datos/movimientos-reglas';
import type { LineaMovimientoConEtiqueta } from '@/datos/repositorios/movimientos';
import type { Movimiento, SentidoMovimiento, TipoMovimiento } from '@/datos/tipos';
import { leerCantidad } from '@/datos/ventas-reglas';

import { motivoDeRechazo, type EstadoPastilla } from './ruta-del-dia';
import { compararEtiquetas } from './venta-pasos';

/**
 * Lo que deciden las pantallas de merma y consumo (T-27 pieza 2), sin React: la
 * tablet no tiene pruebas de pantalla, asi que la validacion vive aqui y la
 * pantalla solo la pinta (mismo criterio que `gasto.ts`). Las reglas de la capa
 * de datos se reexportan: son las mismas que vuelve a revisar
 * `movimientos.registrar` al grabar.
 */
export {
  consumoRestante,
  LARGO_MAX_COMENTARIO_MOVIMIENTO,
  MENSAJE_CONSUMO_AGOTADO,
  MENSAJE_FALTA_RECIBIDO,
  MENSAJE_SIN_CONSUMO,
  motivoDeConsumo,
  textoConsumoRestante,
  validarMovimiento,
} from '@/datos/movimientos-reglas';
export type { EntradaMovimiento, LineaMovimiento } from '@/datos/movimientos-reglas';

export const MENSAJE_DIA_CERRADO_MOVIMIENTO = 'El día ya está cerrado: no se pueden registrar movimientos.';

export const TITULO_MOVIMIENTO: Record<TipoMovimiento, string> = {
  merma_cliente: 'Merma del cliente',
  // Rediseño pieza 4 (maqueta 16): la merma del trayecto se llama "Merma del vehículo".
  merma_trayecto: 'Merma del vehículo',
  consumo: 'Consumo propio',
  cambio: 'Cambio',
};

/** Lo capturado por presentacion, tal cual (el texto de cada campo). */
export type CapturaMovimiento = Record<string, Partial<Record<SentidoMovimiento, string>>>;

/** Escribe un campo sin mutar la captura (la pantalla la guarda en un `useState`). */
export function capturar(
  captura: CapturaMovimiento,
  presentacionId: string,
  sentido: SentidoMovimiento,
  texto: string,
): CapturaMovimiento {
  return { ...captura, [presentacionId]: { ...captura[presentacionId], [sentido]: texto } };
}

/** Las piezas de un campo; vacio o ilegible cuentan 0 (para "Te quedan N"). */
export function piezasCapturadas(
  captura: CapturaMovimiento,
  presentacionId: string,
  sentido: SentidoMovimiento,
): number {
  return leerCantidad(captura[presentacionId]?.[sentido] ?? '') ?? 0;
}

export interface EntradaCapturaMovimiento {
  tipo: TipoMovimiento;
  clienteId: string | null;
  /** Rediseño pieza 4: el motivo elegido (las dos mermas lo exigen). */
  motivoMermaId?: string | null;
  captura: CapturaMovimiento;
  comentario: string;
  /** La jornada de hoy ya esta cerrada (`estadoMenuJornada`). */
  diaCerrado: boolean;
  /** Solo en el consumo: el limite y lo ya registrado hoy. */
  consumo?: { limite: number; consumoDeHoy: number };
}

export interface ValidacionCapturaMovimiento {
  lineas: LineaMovimiento[];
  comentario: string | null;
  /** Lo que falta, en el orden de la pantalla. Vacio = se puede registrar. */
  faltantes: string[];
  listo: boolean;
}

/**
 * La validacion entera de la captura. Pura: misma entrada, misma salida. La
 * existencia NO se revisa aqui (la pantalla pinta "Te quedan N" y la red
 * definitiva es el repositorio al grabar).
 */
export function validarCapturaMovimiento(e: EntradaCapturaMovimiento): ValidacionCapturaMovimiento {
  const lineas: LineaMovimiento[] = [];
  let ilegible = false;
  for (const [presentacionId, campos] of Object.entries(e.captura)) {
    for (const sentido of ['recibido', 'entregado'] as const) {
      const texto = campos[sentido];
      if (texto === undefined) continue;
      const piezas = leerCantidad(texto);
      if (piezas === null) {
        ilegible = true;
        continue;
      }
      if (piezas > 0) lineas.push({ presentacionId, sentido, piezas });
    }
  }
  const comentario = e.comentario.trim() === '' ? null : e.comentario.trim();

  const faltantes: string[] = [];
  if (ilegible) faltantes.push(`Las piezas son números enteros de 1 a ${MAX_PIEZAS_MOVIMIENTO}.`);
  faltantes.push(
    ...validarMovimiento({ tipo: e.tipo, clienteId: e.clienteId, motivoMermaId: e.motivoMermaId, lineas, comentario }),
  );
  if (e.tipo === 'consumo' && e.consumo && lineas.length > 0) {
    const motivo = motivoDeConsumo({
      limite: e.consumo.limite,
      consumoDeHoy: e.consumo.consumoDeHoy,
      piezas: lineas.reduce((total, l) => total + l.piezas, 0),
    });
    if (motivo !== null) faltantes.push(`${motivo}.`);
  }
  if (e.diaCerrado) faltantes.push(MENSAJE_DIA_CERRADO_MOVIMIENTO);

  return { lineas, comentario, faltantes, listo: faltantes.length === 0 };
}

/** Lo que falta se lista solo cuando el vendedor ya empezo a capturar (como el gasto). */
export function faltantesVisiblesMovimiento(e: EntradaCapturaMovimiento, v: ValidacionCapturaMovimiento): string[] {
  const empezo =
    e.comentario !== '' ||
    Object.values(e.captura).some((campos) => Object.values(campos).some((texto) => (texto ?? '') !== ''));
  return empezo ? v.faltantes : [];
}

/** El `tipo` de la captura del menu (parametro de la ruta): solo los que no son de un cliente. */
export function tipoDeCaptura(param: string | string[] | undefined): 'merma_trayecto' | 'consumo' | null {
  return param === 'merma_trayecto' || param === 'consumo' ? param : null;
}

/** D4 / Review Focus 1: con limite 0 el boton "Consumo propio" no se ofrece. */
export function ofreceConsumo(limite: number): boolean {
  return limite > 0;
}

/** La pastilla de UN movimiento en "Movimientos de hoy". */
export function pastillaMovimiento(
  m: Pick<Movimiento, 'sync_estado' | 'sync_error'>,
): { texto: string; estado: EstadoPastilla; detalle: string | null } {
  switch (m.sync_estado) {
    case 'pendiente':
    case 'enviando':
      return { texto: 'por subir', estado: 'pendiente', detalle: null };
    case 'sincronizado':
      return { texto: 'subido', estado: 'listo', detalle: null };
    case 'error':
      return { texto: 'rechazado', estado: 'error', detalle: motivoDeRechazo(m.sync_error) };
  }
}

/**
 * "Me entregó dañado: Jamaica 1 L ×3 · Le entregué: Jamaica 500 ml ×2" (merma del
 * cliente), "Fresa 500 ml por Mango 500 ml" (cambio: lo que regreso el cliente
 * "por" lo que se llevo, sin repetir), o las piezas que salieron.
 */
export function resumenMovimiento(m: { tipo: TipoMovimiento; lineas: readonly LineaMovimientoConEtiqueta[] }): string {
  const lista = (sentido: SentidoMovimiento) =>
    m.lineas
      .filter((l) => l.sentido === sentido)
      .map((l) => `${l.etiqueta} ×${l.piezas}`)
      .join(', ');
  if (m.tipo === 'cambio') {
    const nombres = (sentido: SentidoMovimiento) =>
      [...new Set(m.lineas.filter((l) => l.sentido === sentido).map((l) => l.etiqueta))].join(', ');
    return `${nombres('recibido')} por ${nombres('entregado')}`;
  }
  if (m.tipo !== 'merma_cliente') return lista('entregado');
  const partes = [`Me entregó dañado: ${lista('recibido')}`];
  const entregado = lista('entregado');
  if (entregado !== '') partes.push(`Le entregué: ${entregado}`);
  return partes.join(' · ');
}

/* ------------------------------------------------------------------ */
/* Rediseño pieza 4: Merma y cambios (maquetas 14, 15 y 16)            */
/* ------------------------------------------------------------------ */

/** La etiqueta de tipo de cada renglon del registro (maqueta 15). */
export const ETIQUETA_TIPO_MOVIMIENTO: Record<TipoMovimiento, string> = {
  merma_cliente: 'Merma',
  merma_trayecto: 'Merma',
  consumo: 'Consumo',
  cambio: 'Cambio',
};

export type FiltroMovimientos = 'todo' | 'merma' | 'cambios';

export const FILTROS_MOVIMIENTOS: readonly { clave: FiltroMovimientos; etiqueta: string }[] = [
  { clave: 'todo', etiqueta: 'Todo' },
  { clave: 'merma', etiqueta: 'Merma' },
  { clave: 'cambios', etiqueta: 'Cambios' },
];

/**
 * Los filtros de abajo del registro. "Merma" son las dos mermas (cliente y
 * vehiculo); "Cambios", los cambios. El consumo propio solo sale en "Todo": no
 * es merma ni cambio. Conserva el orden de entrada.
 */
export function filtrarMovimientos<M extends { tipo: TipoMovimiento }>(
  movimientos: readonly M[],
  filtro: FiltroMovimientos,
): M[] {
  switch (filtro) {
    case 'todo':
      return [...movimientos];
    case 'merma':
      return movimientos.filter((m) => m.tipo === 'merma_cliente' || m.tipo === 'merma_trayecto');
    case 'cambios':
      return movimientos.filter((m) => m.tipo === 'cambio');
  }
}

/**
 * Las piezas de UN movimiento en el registro: con un cliente (merma o cambio),
 * lo que el cliente entrego (el mismo numero de la pestaña "Merma · N" /
 * "Cambios · N"); sin cliente (merma del vehiculo, consumo), lo que salio.
 */
export function piezasDelMovimiento(m: {
  tipo: TipoMovimiento;
  lineas: readonly { sentido: SentidoMovimiento; piezas: number }[];
}): number {
  const sentido: SentidoMovimiento = llevaCliente(m.tipo) ? 'recibido' : 'entregado';
  return m.lineas.filter((l) => l.sentido === sentido).reduce((total, l) => total + l.piezas, 0);
}

/** "Hoy · N movimientos · X pzas": la suma de `piezasDelMovimiento`. */
export function totalPiezasDelDia(
  movimientos: readonly { tipo: TipoMovimiento; lineas: readonly { sentido: SentidoMovimiento; piezas: number }[] }[],
): number {
  return movimientos.reduce((total, m) => total + piezasDelMovimiento(m), 0);
}

/** "1 movimiento" / "4 movimientos". */
export function textoMovimientos(n: number): string {
  return `${n} ${n === 1 ? 'movimiento' : 'movimientos'}`;
}

/** "1 pza" / "15 pzas". */
export function textoPzas(n: number): string {
  return `${n} ${n === 1 ? 'pza' : 'pzas'}`;
}

/** Quien en el renglon del registro: el cliente, o "Vehículo" sin cliente. */
export function lugarMovimiento(nombreCliente: string | null | undefined): string {
  return nombreCliente ?? 'Vehículo';
}

/** Junto a la etiqueta de tipo: el motivo de la merma, o el resumen (cambio, consumo, merma sin motivo). */
export function detalleMovimiento(m: {
  tipo: TipoMovimiento;
  motivo_nombre: string | null;
  lineas: readonly LineaMovimientoConEtiqueta[];
}): string {
  return m.motivo_nombre ?? resumenMovimiento(m);
}

/** Las dos pestañas de "Merma y cambios" del cliente; cada una graba su propio movimiento. */
export type PestanaMovimiento = 'merma' | 'cambios';

export const TIPO_DE_PESTANA: Record<PestanaMovimiento, 'merma_cliente' | 'cambio'> = {
  merma: 'merma_cliente',
  cambios: 'cambio',
};

/** Lo capturado en un lado de la captura (para "Merma · N", "Cambios · N" y "N PIEZAS"). */
export function piezasDelSentido(captura: CapturaMovimiento, sentido: SentidoMovimiento): number {
  return Object.keys(captura).reduce((total, id) => total + piezasCapturadas(captura, id, sentido), 0);
}

/** "Merma · 5" / "Cambios · 0": las piezas que entrego el cliente en esa pestaña. */
export function textoPestana(pestana: PestanaMovimiento, captura: CapturaMovimiento): string {
  return `${pestana === 'merma' ? 'Merma' : 'Cambios'} · ${piezasDelSentido(captura, 'recibido')}`;
}

export interface RenglonMovimiento {
  presentacionId: string;
  etiqueta: string;
  /** La existencia con el control de inventario prendido; `null` = sin control. */
  quedan: number | null;
}

/**
 * Las filas del selector "Agregar producto" y de la merma del vehiculo, en el
 * orden de la lista de venta (producto y volumen). `quedan` solo con el control
 * prendido (lo que sale de la camioneta dice "te quedan N").
 */
export function renglonesMovimiento({
  presentaciones,
  existencias,
  controlInventario,
}: {
  presentaciones: readonly { presentacionId: string; etiqueta: string }[];
  existencias: ReadonlyMap<string, { existencia: number }>;
  controlInventario: boolean;
}): RenglonMovimiento[] {
  return presentaciones
    .map((p) => ({
      presentacionId: p.presentacionId,
      etiqueta: p.etiqueta,
      quedan: controlInventario ? (existencias.get(p.presentacionId)?.existencia ?? 0) : null,
    }))
    .sort((a, b) => compararEtiquetas(a.etiqueta, b.etiqueta));
}

/** Los renglones ya capturados de un lado (lo que se ve bajo su encabezado), en el orden de `renglones`. */
export function renglonesCapturados(
  renglones: readonly RenglonMovimiento[],
  captura: CapturaMovimiento,
  sentido: SentidoMovimiento,
): RenglonMovimiento[] {
  return renglones.filter((r) => piezasCapturadas(captura, r.presentacionId, sentido) > 0);
}

/**
 * El tope del teclado: lo que entrega el cliente llega a `MAX_PIEZAS_MOVIMIENTO`;
 * lo que sale de la camioneta, a lo que queda (con el control prendido).
 */
export function topeTeclado(sentido: SentidoMovimiento, quedan: number | null): number {
  if (sentido === 'recibido' || quedan === null) return MAX_PIEZAS_MOVIMIENTO;
  return Math.max(0, Math.min(quedan, MAX_PIEZAS_MOVIMIENTO));
}

/** "4 PIEZAS" de la barra de abajo. */
export function textoPiezasBarra(n: number): string {
  return `${n} ${n === 1 ? 'PIEZA' : 'PIEZAS'}`;
}

export interface GuardiaRegistro {
  /** `null` = se ignoro: ya se grabo (o se esta grabando) con esta pantalla. */
  intentar<T>(grabar: () => T): T | null;
}

/**
 * Guardia contra el doble toque (leccion de T-39): `registrar()` genera un id
 * nuevo cada vez y `router.back()` deja la pantalla montada durante la
 * transicion, asi que un segundo toque en cola grabaria otro movimiento. Tras
 * grabar se queda cerrada; si grabar lanza (no se grabo), se suelta para
 * reintentar. La pantalla la guarda en un `useState(() => …)`.
 */
export function crearGuardiaRegistro(): GuardiaRegistro {
  let cerrada = false;
  return {
    intentar<T>(grabar: () => T): T | null {
      if (cerrada) return null;
      cerrada = true;
      try {
        return grabar();
      } catch (error) {
        cerrada = false;
        throw error;
      }
    },
  };
}
