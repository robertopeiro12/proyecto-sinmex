import {
  MAX_PIEZAS_MOVIMIENTO,
  motivoDeConsumo,
  validarMovimiento,
  type LineaMovimiento,
} from '@/datos/movimientos-reglas';
import type { LineaMovimientoConEtiqueta } from '@/datos/repositorios/movimientos';
import type { Movimiento, SentidoMovimiento, TipoMovimiento } from '@/datos/tipos';
import { leerCantidad } from '@/datos/ventas-reglas';

import { motivoDeRechazo, type EstadoPastilla } from './ruta-del-dia';

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
  merma_trayecto: 'Merma del trayecto',
  consumo: 'Consumo propio',
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
  faltantes.push(...validarMovimiento({ tipo: e.tipo, clienteId: e.clienteId, lineas, comentario }));
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

/** "Recibí dañado: Jamaica 1 L ×3 · Le entregué: Jamaica 500 ml ×2", o las piezas que salieron. */
export function resumenMovimiento(m: { tipo: TipoMovimiento; lineas: readonly LineaMovimientoConEtiqueta[] }): string {
  const lista = (sentido: SentidoMovimiento) =>
    m.lineas
      .filter((l) => l.sentido === sentido)
      .map((l) => `${l.etiqueta} ×${l.piezas}`)
      .join(', ');
  if (m.tipo !== 'merma_cliente') return lista('entregado');
  const partes = [`Recibí dañado: ${lista('recibido')}`];
  const entregado = lista('entregado');
  if (entregado !== '') partes.push(`Le entregué: ${entregado}`);
  return partes.join(' · ');
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
