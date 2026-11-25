import type { SentidoMovimiento, TipoMovimiento } from './tipos';

/**
 * La forma de un movimiento de inventario y el limite de consumo (T-27 pieza 2;
 * el cambio y el motivo de merma son del rediseño, pieza 4), sin SQLite ni React.
 *
 * Vive en `src/datos/` porque `movimientos.registrar` la vuelve a calcular
 * DENTRO de su transaccion, y `src/datos/` no importa de `src/estado/`.
 * `src/estado/movimiento.ts` la reexporta para las pantallas. Los topes son los
 * del servidor (`modules/inventario/datos-movimiento.ts`).
 */

export const MAX_PIEZAS_MOVIMIENTO = 99_999;
export const LARGO_MAX_COMENTARIO_MOVIMIENTO = 300;

export const MENSAJE_FALTA_RECIBIDO = 'Captura al menos una pieza en «Recibí dañado».';
export const MENSAJE_SIN_PIEZAS = 'Captura al menos una pieza.';
/** Rediseño pieza 4 (decision 1 del plan): las dos mermas llevan motivo. */
export const MENSAJE_FALTA_MOTIVO = 'Elige el motivo de la merma.';
/** Rediseño pieza 4 (decision 2 del plan): un cambio recibe y entrega. */
export const MENSAJE_CAMBIO_SIN_RECIBIDO = 'Captura al menos una pieza en «Me entregó el cliente».';
export const MENSAJE_CAMBIO_SIN_ENTREGADO = 'Captura al menos una pieza en «Le entregué».';
/** Review Focus 1 (spec). Sin punto: el repositorio se lo agrega al lanzar. */
export const MENSAJE_CONSUMO_AGOTADO = 'Ya registraste tu consumo de hoy';
export const MENSAJE_SIN_CONSUMO = 'Tu sucursal no tiene consumo propio';

export interface LineaMovimiento {
  presentacionId: string;
  sentido: SentidoMovimiento;
  piezas: number;
}

/** Lo que se va a grabar, sin vendedor (`comentario` ya recortado o null). */
export interface EntradaMovimiento {
  tipo: TipoMovimiento;
  clienteId: string | null;
  /**
   * Rediseño pieza 4: obligatorio en `merma_cliente` y `merma_trayecto`,
   * prohibido en `cambio` y `consumo`. Ausente = sin motivo.
   */
  motivoMermaId?: string | null;
  lineas: readonly LineaMovimiento[];
  comentario: string | null;
}

/** La merma del cliente y el cambio llevan cliente; los demas no. */
export function llevaCliente(tipo: TipoMovimiento): boolean {
  return tipo === 'merma_cliente' || tipo === 'cambio';
}

/** Las dos mermas llevan motivo (rediseño pieza 4); el cambio y el consumo no. */
export function llevaMotivo(tipo: TipoMovimiento): boolean {
  return tipo === 'merma_cliente' || tipo === 'merma_trayecto';
}

/**
 * Errores de forma (los mismos que revisa el servidor), en espanol para el
 * vendedor. Vacio = se puede grabar (falta el limite y la existencia, que
 * dependen de la base).
 */
export function validarMovimiento(e: EntradaMovimiento): string[] {
  const errores: string[] = [];
  const delCliente = e.tipo === 'merma_cliente';
  const esCambio = e.tipo === 'cambio';
  const conCliente = llevaCliente(e.tipo);

  if (delCliente && e.clienteId === null) errores.push('La merma del cliente necesita al cliente.');
  if (esCambio && e.clienteId === null) errores.push('El cambio necesita al cliente.');
  if (!conCliente && e.clienteId !== null) errores.push('La merma del trayecto y el consumo no llevan cliente.');

  const motivo = e.motivoMermaId ?? null;
  if (llevaMotivo(e.tipo) && motivo === null) errores.push(MENSAJE_FALTA_MOTIVO);
  if (!llevaMotivo(e.tipo) && motivo !== null) errores.push('El cambio y el consumo no llevan motivo de merma.');

  // D2: "Recibí dañado" lleva al menos una pieza (Review Focus 3).
  if (delCliente && !e.lineas.some((l) => l.sentido === 'recibido')) errores.push(MENSAJE_FALTA_RECIBIDO);
  if (esCambio) {
    if (!e.lineas.some((l) => l.sentido === 'recibido')) errores.push(MENSAJE_CAMBIO_SIN_RECIBIDO);
    if (!e.lineas.some((l) => l.sentido === 'entregado')) errores.push(MENSAJE_CAMBIO_SIN_ENTREGADO);
  }
  if (!conCliente && e.lineas.length === 0) errores.push(MENSAJE_SIN_PIEZAS);

  const vistas = new Set<string>();
  let fueraDeRango = false;
  let repetida = false;
  let entraSinCliente = false;
  for (const l of e.lineas) {
    if (!Number.isInteger(l.piezas) || l.piezas < 1 || l.piezas > MAX_PIEZAS_MOVIMIENTO) fueraDeRango = true;
    const llave = `${l.presentacionId}|${l.sentido}`;
    if (vistas.has(llave)) repetida = true;
    vistas.add(llave);
    if (!conCliente && l.sentido === 'recibido') entraSinCliente = true;
  }
  if (fueraDeRango) errores.push(`Las piezas de cada producto van de 1 a ${MAX_PIEZAS_MOVIMIENTO}.`);
  if (repetida) errores.push('La misma presentación viene dos veces.');
  if (entraSinCliente) errores.push('Aquí solo se registran piezas que salen de la camioneta.');

  if (e.comentario !== null && e.comentario.trim().length > LARGO_MAX_COMENTARIO_MOVIMIENTO) {
    errores.push(`El comentario lleva hasta ${LARGO_MAX_COMENTARIO_MOVIMIENTO} caracteres.`);
  }
  return errores;
}

/** Cuantas piezas de consumo le quedan hoy (nunca negativo). */
export function consumoRestante({ limite, consumoDeHoy }: { limite: number; consumoDeHoy: number }): number {
  return Math.max(0, limite - consumoDeHoy);
}

/** "Te quedan N de consumo hoy" (spec). */
export function textoConsumoRestante(restante: number): string {
  return `Te quedan ${restante} de consumo hoy`;
}

/**
 * D4: por que no se pueden registrar `piezas` de consumo hoy, o `null` si
 * caben. Cuenta piezas (la ayuda del portal: "Piezas que cada vendedor puede
 * registrar como consumo propio en un día").
 */
export function motivoDeConsumo({
  limite,
  consumoDeHoy,
  piezas,
}: {
  limite: number;
  consumoDeHoy: number;
  piezas: number;
}): string | null {
  if (limite <= 0) return MENSAJE_SIN_CONSUMO;
  const restante = consumoRestante({ limite, consumoDeHoy });
  if (restante === 0) return MENSAJE_CONSUMO_AGOTADO;
  if (piezas > restante) return `${textoConsumoRestante(restante)}; no puedes registrar ${piezas}`;
  return null;
}
