/**
 * Reglas del Registro de Operacion (parte 1), sin base ni Nest: de que dia se
 * puede capturar cada tipo, la validacion de una captura y el plan de lineas de
 * una correccion. "Hoy en Tijuana" llega de fuera, del reloj de Postgres.
 * Spec: docs/superpowers/specs/2026-11-24-registro-de-operacion-parte-1-design.md
 * (D1, D13, D18).
 */
import {
  esFechaReal,
  MENSAJE_FECHA_FUTURA,
  MENSAJE_FECHA_INVALIDA,
  MENSAJE_PRESENTACION_REPETIDA,
} from './reglas-comunes';

export const TIPOS_OPERACION = [
  'entrada',
  'envio',
  'merma',
  'consumo',
  'descuento',
  'retiro_merma',
] as const;
export type TipoOperacion = (typeof TIPOS_OPERACION)[number];

export const ORIGENES_ENTRADA = ['produccion', 'compra'] as const;
export type OrigenEntrada = (typeof ORIGENES_ENTRADA)[number];

/** Retiro de merma (parte 2): el estado de la autorizacion. */
export const ESTADOS_RETIRO = ['pendiente', 'autorizado', 'rechazado'] as const;
export type EstadoRetiro = (typeof ESTADOS_RETIRO)[number];

export const MAX_MOTIVO_RECHAZO = 300;
export const MENSAJE_MOTIVO_RECHAZO = 'Escribe el motivo del rechazo.';
export const MENSAJE_MOTIVO_RECHAZO_LARGO = `El motivo no puede pasar de ${MAX_MOTIVO_RECHAZO} caracteres.`;

export const MAX_LINEAS = 200;
export const MAX_PIEZAS = 100_000;
export const MAX_TRABAJADOR = 120;
export const MAX_COMENTARIO = 300;

export const MENSAJE_ENVIO_FECHA = 'Un envío solo puede ser de hoy o de ayer.';
export const MENSAJE_ORIGEN =
  'Elige si la entrada es de producción o de compra.';
export const MENSAJE_DESTINO = 'Elige la sucursal de destino.';
export const MENSAJE_DESTINO_IGUAL = 'El destino tiene que ser otra sucursal.';
export const MENSAJE_MOTIVO = 'Elige el motivo de la merma.';
export const MENSAJE_TRABAJADOR = 'Escribe el nombre del trabajador.';
export const MENSAJE_TRABAJADOR_LARGO = `El nombre del trabajador no puede pasar de ${MAX_TRABAJADOR} caracteres.`;
export const MENSAJE_COMENTARIO_LARGO = `El comentario no puede pasar de ${MAX_COMENTARIO} caracteres.`;
export const MENSAJE_SIN_LINEAS = 'Captura al menos una presentación.';
export const MENSAJE_DEMASIADAS_LINEAS = `Una operación no puede llevar más de ${MAX_LINEAS} presentaciones.`;
export const MENSAJE_PIEZAS = `Las piezas deben ser un número entero entre 1 y ${MAX_PIEZAS}.`;

export interface LineaPedida {
  presentacionId: string;
  piezas: number;
}

/** Una linea viva de una operacion guardada. */
export interface LineaViva extends LineaPedida {
  id: string;
}

/** Lo que pide una captura (codigos de sucursal, ya en mayusculas). */
export interface EntradaOperacion {
  tipo: TipoOperacion;
  fecha: string;
  sucursal: string;
  origen?: string | null;
  destino?: string | null;
  motivoId?: string | null;
  trabajador?: string | null;
  comentario?: string | null;
  lineas: LineaPedida[];
}

/** `AAAA-MM-DD` del dia anterior (aritmetica de calendario, sin zonas). */
export function diaAnterior(fecha: string): string {
  const [a, m, d] = fecha.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d - 1)).toISOString().slice(0, 10);
}

/**
 * D13: entrada, merma, consumo y descuento, cualquier dia hasta hoy; envio, solo
 * hoy o ayer. Vale para crear, corregir y dar de baja (con la fecha guardada).
 */
export function fechaPermitida(
  tipo: TipoOperacion,
  fecha: string,
  hoy: string,
): boolean {
  if (!esFechaReal(fecha) || fecha > hoy) return false;
  if (tipo === 'envio') return fecha === hoy || fecha === diaAnterior(hoy);
  return true;
}

/** Mensajes de error de la captura; `[]` = valida. */
export function validarOperacion(e: EntradaOperacion, hoy: string): string[] {
  const mensajes: string[] = [];

  if (!esFechaReal(e.fecha)) mensajes.push(MENSAJE_FECHA_INVALIDA);
  else if (e.fecha > hoy) mensajes.push(MENSAJE_FECHA_FUTURA);
  else if (!fechaPermitida(e.tipo, e.fecha, hoy))
    mensajes.push(MENSAJE_ENVIO_FECHA);

  if (
    e.tipo === 'entrada' &&
    !(ORIGENES_ENTRADA as readonly unknown[]).includes(e.origen)
  )
    mensajes.push(MENSAJE_ORIGEN);

  if (e.tipo === 'envio') {
    if (!e.destino) mensajes.push(MENSAJE_DESTINO);
    else if (e.destino.trim().toUpperCase() === e.sucursal.toUpperCase())
      mensajes.push(MENSAJE_DESTINO_IGUAL);
  }

  if (e.tipo === 'merma' && !e.motivoId) mensajes.push(MENSAJE_MOTIVO);

  if (e.tipo === 'descuento') {
    const trabajador = (e.trabajador ?? '').trim();
    if (trabajador === '') mensajes.push(MENSAJE_TRABAJADOR);
    else if (trabajador.length > MAX_TRABAJADOR)
      mensajes.push(MENSAJE_TRABAJADOR_LARGO);
  }

  if ((e.comentario ?? '').trim().length > MAX_COMENTARIO)
    mensajes.push(MENSAJE_COMENTARIO_LARGO);

  if (e.lineas.length === 0) mensajes.push(MENSAJE_SIN_LINEAS);
  else if (e.lineas.length > MAX_LINEAS)
    mensajes.push(MENSAJE_DEMASIADAS_LINEAS);

  if (
    e.lineas.some(
      (l) =>
        typeof l.piezas !== 'number' ||
        !Number.isInteger(l.piezas) ||
        l.piezas < 1 ||
        l.piezas > MAX_PIEZAS,
    )
  )
    mensajes.push(MENSAJE_PIEZAS);

  const ids = e.lineas.map((l) => l.presentacionId);
  if (new Set(ids).size !== ids.length)
    mensajes.push(MENSAJE_PRESENTACION_REPETIDA);

  return mensajes;
}

/** Compara las lineas vivas con las pedidas: que crear, corregir o borrar. */
export function planLineas(
  vivas: LineaViva[],
  pedidas: LineaPedida[],
): {
  crear: LineaPedida[];
  actualizar: { id: string; piezas: number }[];
  borrar: string[];
} {
  const pedidasPor = new Map(pedidas.map((l) => [l.presentacionId, l.piezas]));
  const vivasPor = new Map(vivas.map((l) => [l.presentacionId, l]));

  const crear = pedidas.filter((l) => !vivasPor.has(l.presentacionId));
  const actualizar: { id: string; piezas: number }[] = [];
  const borrar: string[] = [];
  for (const viva of vivas) {
    const piezas = pedidasPor.get(viva.presentacionId);
    if (piezas === undefined) borrar.push(viva.id);
    else if (piezas !== viva.piezas) actualizar.push({ id: viva.id, piezas });
  }
  return { crear, actualizar, borrar };
}

/** Producción puede corregir o dar de baja un retiro pendiente o rechazado; uno autorizado es final. */
export function retiroEditable(estado: EstadoRetiro | null): boolean {
  return estado !== 'autorizado';
}

/** Administración solo resuelve (autoriza o rechaza) un retiro pendiente. */
export function retiroResoluble(estado: EstadoRetiro | null): boolean {
  return estado === 'pendiente';
}

/** Mensajes del motivo de un rechazo; `[]` = valido. */
export function validarMotivoRechazo(
  motivo: string | null | undefined,
): string[] {
  const m = (motivo ?? '').trim();
  if (m === '') return [MENSAJE_MOTIVO_RECHAZO];
  if (m.length > MAX_MOTIVO_RECHAZO) return [MENSAJE_MOTIVO_RECHAZO_LARGO];
  return [];
}

/** Mensaje del 409 cuando el retiro ya no está en el estado que la acción necesita. */
export function mensajeRetiroNoPendiente(estado: EstadoRetiro | null): string {
  if (estado === 'autorizado') return 'Este retiro ya fue autorizado.';
  if (estado === 'rechazado')
    return 'Este retiro ya fue rechazado; Producción lo tiene que corregir y reenviar.';
  return 'Este retiro no está pendiente de autorización.';
}

export const MENSAJE_RETIRO_AUTORIZADO =
  'Un retiro autorizado ya no se puede corregir ni dar de baja.';
