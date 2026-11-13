/**
 * Reglas del corte de mercancia, sin base ni Nest: la UNICA fuente de la cuenta
 * "deberia regresar" y del faltante, mas la validacion y el plan del guardado.
 * Spec: docs/superpowers/specs/2026-11-12-corte-de-mercancia-design.md (D7–D9, D13).
 *
 * Cuando la tablet registre merma, cambios y consumo (T-33), se restan aqui, en
 * `deberiaRegresar`, sin cambiar la pantalla.
 */
import {
  esFechaReal,
  MENSAJE_FECHA_FUTURA,
  MENSAJE_FECHA_INVALIDA,
  MENSAJE_PRESENTACION_REPETIDA,
} from './reglas-produccion';

export type EstadoCorte = 'sin_corte' | 'hecho' | 'con_faltante';

export const MENSAJE_CONTEO_INVALIDO =
  'Las buenas y la merma deben ser números enteros mayores o iguales a 0.';

/** Lo que se movio de una presentacion ese dia para un vendedor. */
export interface MovimientoPresentacion {
  presentacionId: string;
  /** Producto + tamano ("Horchata 1 L"). */
  nombre: string;
  /** Piezas de cargas aceptadas. */
  cargadas: number;
  /** `cantidad` de lineas vivas de ventas vivas. */
  vendidas: number;
  /** `cantidad_promocion` de esas mismas lineas. */
  regaladas: number;
  /** Lo contado por el almacen (0 si no hay fila). */
  buenas: number;
  merma: number;
}

export interface LineaCorte extends MovimientoPresentacion {
  /** Sin recortar: negativo = vendio mas de lo cargado (D13). */
  deberiaRegresar: number;
  /** `null` si el corte no esta hecho; < 0 = sobrante (D9). */
  faltante: number | null;
}

export interface TotalesCorte {
  cargadas: number;
  vendidas: number;
  regaladas: number;
  deberiaRegresar: number;
  buenas: number;
  merma: number;
  /**
   * Piezas que faltan: suma de los faltantes > 0 (un sobrante de una
   * presentacion no compensa lo que falta de otra). `null` si no esta hecho.
   */
  faltante: number | null;
}

/** Deberia regresar = cargadas − vendidas − regaladas (D7). No se recorta a 0. */
export function deberiaRegresar(m: {
  cargadas: number;
  vendidas: number;
  regaladas: number;
}): number {
  return m.cargadas - m.vendidas - m.regaladas;
}

/**
 * Lo que el vendedor todavia trae en la camioneta, por presentacion: la MISMA
 * cuenta que "deberia regresar" (`deberiaRegresar`), en vivo. La usa la venta
 * del portal para no venderle a un vendedor mas de lo que trae cargado (con
 * `sucursal.control_inventario` prendida, como la app de T-27).
 *
 * Cuando exista la merma y el consumo de la tablet (PR #150 / T-33), se restan
 * en `deberiaRegresar` y esta existencia los descuenta sola.
 */
export function existenciasPorPresentacion(
  movimientos: readonly MovimientoPresentacion[],
): Map<string, number> {
  return new Map(
    movimientos.map((m) => [m.presentacionId, deberiaRegresar(m)]),
  );
}

/** Faltante = deberia − buenas, solo con el corte hecho (D9). */
export function faltante(
  deberia: number,
  buenas: number,
  hecho: boolean,
): number | null {
  return hecho ? deberia - buenas : null;
}

/** Sin corte, hecho, o hecho con alguna presentacion faltante. */
export function estadoCorte(
  hecho: boolean,
  lineas: readonly { faltante: number | null }[],
): EstadoCorte {
  if (!hecho) return 'sin_corte';
  return lineas.some((l) => (l.faltante ?? 0) > 0) ? 'con_faltante' : 'hecho';
}

/** El corte de un vendedor y un dia: lineas con la cuenta, totales y estado. */
export function armarCorte(
  movimientos: readonly MovimientoPresentacion[],
  hecho: boolean,
): { lineas: LineaCorte[]; totales: TotalesCorte; estado: EstadoCorte } {
  const lineas = movimientos.map((m) => {
    const deberia = deberiaRegresar(m);
    return {
      ...m,
      deberiaRegresar: deberia,
      faltante: faltante(deberia, m.buenas, hecho),
    };
  });
  const suma = (campo: keyof Omit<TotalesCorte, 'faltante'>) =>
    lineas.reduce((total, l) => total + l[campo], 0);
  return {
    lineas,
    totales: {
      cargadas: suma('cargadas'),
      vendidas: suma('vendidas'),
      regaladas: suma('regaladas'),
      deberiaRegresar: suma('deberiaRegresar'),
      buenas: suma('buenas'),
      merma: suma('merma'),
      faltante: hecho
        ? lineas.reduce((t, l) => t + Math.max(l.faltante ?? 0, 0), 0)
        : null,
    },
    estado: estadoCorte(hecho, lineas),
  };
}

/** Una presentacion del conteo que manda el portal. 0/0 = sin registro. */
export interface ConteoPedido {
  presentacionId: string;
  buenas: number;
  merma: number;
}

/** Una fila viva de `retorno`. */
export interface ConteoVivo extends ConteoPedido {
  id: string;
}

const esConteo = (n: unknown) =>
  typeof n === 'number' && Number.isInteger(n) && n >= 0;

/** Mensajes de error del corte pedido; `[]` = valido. Hasta hoy (D10). */
export function validarCorte(
  entrada: { fecha: string; lineas: readonly ConteoPedido[] },
  hoyTijuana: string,
): string[] {
  const mensajes: string[] = [];
  if (!esFechaReal(entrada.fecha)) mensajes.push(MENSAJE_FECHA_INVALIDA);
  else if (entrada.fecha > hoyTijuana) mensajes.push(MENSAJE_FECHA_FUTURA);

  if (entrada.lineas.some((l) => !esConteo(l.buenas) || !esConteo(l.merma)))
    mensajes.push(MENSAJE_CONTEO_INVALIDO);

  const ids = entrada.lineas.map((l) => l.presentacionId);
  if (new Set(ids).size !== ids.length)
    mensajes.push(MENSAJE_PRESENTACION_REPETIDA);
  return mensajes;
}

/**
 * Compara lo vivo con lo pedido, como `planDelDia` de la produccion pero con
 * dos cifras: ausente o 0/0 = sin registro (la fila viva se da de baja).
 */
export function planCorte(
  vivas: readonly ConteoVivo[],
  pedidas: readonly ConteoPedido[],
): {
  crear: ConteoPedido[];
  actualizar: { id: string; buenas: number; merma: number }[];
  borrar: string[];
} {
  const conPiezas = (l: ConteoPedido) => l.buenas + l.merma > 0;
  const pedidasPor = new Map(pedidas.map((l) => [l.presentacionId, l]));
  const vivasPor = new Set(vivas.map((f) => f.presentacionId));

  const crear = pedidas.filter(
    (l) => conPiezas(l) && !vivasPor.has(l.presentacionId),
  );
  const actualizar: { id: string; buenas: number; merma: number }[] = [];
  const borrar: string[] = [];
  for (const fila of vivas) {
    const pedida = pedidasPor.get(fila.presentacionId);
    if (!pedida || !conPiezas(pedida)) borrar.push(fila.id);
    else if (pedida.buenas !== fila.buenas || pedida.merma !== fila.merma)
      actualizar.push({
        id: fila.id,
        buenas: pedida.buenas,
        merma: pedida.merma,
      });
  }
  return { crear, actualizar, borrar };
}
