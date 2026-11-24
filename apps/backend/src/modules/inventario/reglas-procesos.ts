/**
 * Reglas de Operacion -> Procesos (PR A), sin base ni Nest: la validacion de una
 * captura de merma, cambio, consumo, promocion o descuento. "Hoy en Tijuana"
 * llega de fuera, del reloj de Postgres.
 * Spec: docs/superpowers/specs/2026-11-25-procesos-design.md (D2, D3).
 *
 * Lo que necesita la base (cliente y vendedor vivos y de la sucursal,
 * presentaciones vivas y activas) lo revisa el servicio.
 */
import {
  esFechaReal,
  MENSAJE_FECHA_FUTURA,
  MENSAJE_FECHA_INVALIDA,
  MENSAJE_PRESENTACION_REPETIDA,
} from '../produccion/reglas-comunes';

export const TIPOS_PROCESO = [
  'merma',
  'cambio',
  'consumo',
  'promocion',
  'descuento',
] as const;
export type TipoProceso = (typeof TIPOS_PROCESO)[number];

export const MERMA_DE = ['cliente', 'almacen'] as const;
export type MermaDe = (typeof MERMA_DE)[number];

export const SENTIDOS = ['recibido', 'entregado'] as const;
export type Sentido = (typeof SENTIDOS)[number];

export const MAX_LINEAS_PROCESO = 200;
export const MAX_PIEZAS_PROCESO = 100_000;
export const MAX_COMENTARIO_PROCESO = 300;

export const MENSAJE_TIPO_PROCESO = 'Elige el tipo de proceso.';
export const MENSAJE_MERMA_DE =
  'Elige si la merma es de un cliente o del almacén.';
export const MENSAJE_CLIENTE = 'Elige un cliente.';
export const MENSAJE_VENDEDOR_DESCUENTO =
  'Un descuento tiene que ser de un vendedor.';
export const MENSAJE_COMENTARIO_PROCESO = `El comentario no puede pasar de ${MAX_COMENTARIO_PROCESO} caracteres.`;
export const MENSAJE_SIN_LINEAS_PROCESO = 'Captura al menos una presentación.';
export const MENSAJE_DEMASIADAS_LINEAS_PROCESO = `Un proceso no puede llevar más de ${MAX_LINEAS_PROCESO} presentaciones.`;
export const MENSAJE_PIEZAS_PROCESO = `Las piezas deben ser un número entero entre 1 y ${MAX_PIEZAS_PROCESO}.`;
export const MENSAJE_SENTIDO =
  'Una de las líneas no dice si se recibió o se entregó.';
export const MENSAJE_RECIBIDO_Y_ENTREGADO =
  'Captura lo que recibiste y lo que entregaste.';

/** Mensaje cuando el tipo admite un solo sentido y llego el otro. */
const MENSAJE_SOLO: Record<string, string> = {
  consumo: 'Un consumo solo lleva piezas entregadas.',
  promocion: 'Una promoción solo lleva piezas entregadas.',
  descuento: 'Un descuento solo lleva piezas entregadas.',
  almacen: 'Una merma de almacén solo lleva piezas recibidas.',
};

export function mensajeCuadre(entregado: number, recibido: number): string {
  return `Lo entregado (${entregado}) no cuadra con lo recibido (${recibido}).`;
}

export interface LineaProcesoPedida {
  presentacionId: string;
  /** Llega crudo: la regla dice si es `recibido` o `entregado`. */
  sentido: string;
  piezas: number;
}

/** Lo que pide una captura (crudo, del cuerpo de la peticion). */
export interface EntradaProceso {
  tipo: TipoProceso;
  fecha: string;
  /** Hoy en Tijuana (`AAAA-MM-DD`). */
  hoy: string;
  mermaDe?: MermaDe | null;
  clienteId?: string | null;
  /** null = Oficina. */
  vendedorId?: string | null;
  comentario?: string | null;
  lineas: LineaProcesoPedida[];
}

export interface LineaProcesoLimpia {
  presentacionId: string;
  sentido: Sentido;
  piezas: number;
}

/** La captura lista para guardar: lo que no es del tipo, en null; ids en minusculas. */
export interface EntradaProcesoLimpia {
  tipo: TipoProceso;
  fecha: string;
  mermaDe: MermaDe | null;
  clienteId: string | null;
  vendedorId: string | null;
  comentario: string | null;
  lineas: LineaProcesoLimpia[];
}

export type ResultadoProceso =
  { ok: true; valor: EntradaProcesoLimpia } | { ok: false; error: string };

/** Que sentidos admite cada tipo (la merma, segun de quien sea). */
function sentidosPermitidos(
  tipo: TipoProceso,
  mermaDe: MermaDe | null,
): readonly Sentido[] {
  if (tipo === 'cambio' || (tipo === 'merma' && mermaDe === 'cliente'))
    return SENTIDOS;
  if (tipo === 'merma') return ['recibido'];
  return ['entregado'];
}

/** Lleva cliente: merma de cliente, cambio y promocion. */
export function llevaCliente(
  tipo: TipoProceso,
  mermaDe: MermaDe | null,
): boolean {
  return (
    tipo === 'cambio' ||
    tipo === 'promocion' ||
    (tipo === 'merma' && mermaDe === 'cliente')
  );
}

/**
 * Valida una captura y la devuelve limpia, o el primer error en espanol. Lo que
 * no es del tipo (cliente en un consumo, `mermaDe` fuera de merma) se ignora,
 * como en el Registro de Operacion: la pantalla conserva el cliente elegido al
 * cambiar de pestana.
 */
export function validarProceso(e: EntradaProceso): ResultadoProceso {
  const falla = (error: string): ResultadoProceso => ({ ok: false, error });

  if (!(TIPOS_PROCESO as readonly unknown[]).includes(e.tipo))
    return falla(MENSAJE_TIPO_PROCESO);
  if (!esFechaReal(e.fecha)) return falla(MENSAJE_FECHA_INVALIDA);
  if (e.fecha > e.hoy) return falla(MENSAJE_FECHA_FUTURA);

  let mermaDe: MermaDe | null = null;
  if (e.tipo === 'merma') {
    if (!(MERMA_DE as readonly unknown[]).includes(e.mermaDe))
      return falla(MENSAJE_MERMA_DE);
    mermaDe = e.mermaDe!;
  }

  let clienteId: string | null = null;
  if (llevaCliente(e.tipo, mermaDe)) {
    if (!e.clienteId) return falla(MENSAJE_CLIENTE);
    clienteId = e.clienteId.toLowerCase();
  }

  const vendedorId = e.vendedorId ? e.vendedorId.toLowerCase() : null;
  if (e.tipo === 'descuento' && vendedorId === null)
    return falla(MENSAJE_VENDEDOR_DESCUENTO);

  const comentario = (e.comentario ?? '').trim();
  if (comentario.length > MAX_COMENTARIO_PROCESO)
    return falla(MENSAJE_COMENTARIO_PROCESO);

  if (e.lineas.length === 0) return falla(MENSAJE_SIN_LINEAS_PROCESO);
  if (e.lineas.length > MAX_LINEAS_PROCESO)
    return falla(MENSAJE_DEMASIADAS_LINEAS_PROCESO);

  if (
    e.lineas.some(
      (l) =>
        typeof l.piezas !== 'number' ||
        !Number.isInteger(l.piezas) ||
        l.piezas < 1 ||
        l.piezas > MAX_PIEZAS_PROCESO,
    )
  )
    return falla(MENSAJE_PIEZAS_PROCESO);

  if (
    e.lineas.some((l) => !(SENTIDOS as readonly unknown[]).includes(l.sentido))
  )
    return falla(MENSAJE_SENTIDO);

  const lineas: LineaProcesoLimpia[] = e.lineas.map((l) => ({
    presentacionId: l.presentacionId.toLowerCase(),
    sentido: l.sentido as Sentido,
    piezas: l.piezas,
  }));

  const claves = lineas.map((l) => `${l.presentacionId}|${l.sentido}`);
  if (new Set(claves).size !== claves.length)
    return falla(MENSAJE_PRESENTACION_REPETIDA);

  const permitidos = sentidosPermitidos(e.tipo, mermaDe);
  if (lineas.some((l) => !permitidos.includes(l.sentido)))
    return falla(MENSAJE_SOLO[mermaDe === 'almacen' ? 'almacen' : e.tipo]);

  if (permitidos.length === 2) {
    const total = (s: Sentido) =>
      lineas
        .filter((l) => l.sentido === s)
        .reduce((suma, l) => suma + l.piezas, 0);
    const recibido = total('recibido');
    const entregado = total('entregado');
    if (recibido === 0 || entregado === 0)
      return falla(MENSAJE_RECIBIDO_Y_ENTREGADO);
    if (recibido !== entregado)
      return falla(mensajeCuadre(entregado, recibido));
  }

  return {
    ok: true,
    valor: {
      tipo: e.tipo,
      fecha: e.fecha,
      mermaDe,
      clienteId,
      vendedorId,
      comentario: comentario === '' ? null : comentario,
      lineas,
    },
  };
}
