/**
 * Reglas del corte de mercancia, sin base ni Nest: la UNICA fuente de la cuenta
 * "piezas teoricas por regresar" (`deberiaRegresar`), de la merma teorica y de
 * los faltantes, mas la validacion y el plan del guardado.
 * Specs: docs/superpowers/specs/2026-11-12-corte-de-mercancia-design.md (D7–D9, D13)
 * y 2026-11-18-corte-por-tamano-y-merma-design.md (C3–C6, D1, D3, D8, D9).
 *
 * La teorica resta merma entregada, merma de almacen, consumo y cambios
 * entregados, y suma los cambios recibidos: el cambio fisico con el cliente lo
 * captura la tablet (rediseño pieza 4, `movimiento_inventario` tipo `cambio`) y
 * la oficina (Operacion -> Procesos). La merma teorica no cuenta los cambios.
 */
import {
  esFechaReal,
  MENSAJE_FECHA_FUTURA,
  MENSAJE_FECHA_INVALIDA,
  MENSAJE_PRESENTACION_REPETIDA,
} from './reglas-comunes';

export type EstadoCorte = 'sin_corte' | 'hecho' | 'con_faltante';

export const MENSAJE_CONTEO_INVALIDO =
  'Las buenas y la merma deben ser números enteros mayores o iguales a 0.';

/** Lo que se movio de una presentacion ese dia para un vendedor. */
export interface MovimientoPresentacion {
  presentacionId: string;
  /** Producto + tamano ("Horchata 1 L"). */
  nombre: string;
  /** Solo el producto ("Horchata"). */
  producto: string;
  /** Tamano tal cual esta en la presentacion ("500 ml"). */
  volumen: string;
  /**
   * Piezas de los renglones aceptados de cargas aceptadas (pieza 3: un renglon
   * con `aceptada = false` no cuenta; `null` en una aceptada vieja, si).
   */
  cargadas: number;
  /** `cantidad` de lineas vivas de ventas vivas. */
  vendidas: number;
  /** `cantidad_promocion` de esas mismas lineas. */
  regaladas: number;
  /** Merma del cliente: piezas buenas que se le entregaron. */
  mermaEntregada: number;
  /** Merma del cliente: piezas danadas que se recibieron. */
  mermaRecibida: number;
  /** Merma del trayecto (almacen). */
  mermaAlmacen: number;
  consumo: number;
  /** Cambios fisicos: piezas entregadas y recibidas (tablet, tipo `cambio`, y Operacion -> Procesos). */
  cambiosEntregados: number;
  cambiosRecibidos: number;
  /** Lo contado por el almacen (0 si no hay fila). */
  buenas: number;
  merma: number;
}

export interface LineaCorte extends MovimientoPresentacion {
  /** Piezas teoricas por regresar. Sin recortar: negativo = vendio mas de lo cargado (D13). */
  deberiaRegresar: number;
  /** Merma teorica por regresar (C4). */
  mermaTeorica: number;
  /** Resultado de piezas; `null` si el corte no esta hecho; < 0 = sobrante (D9). */
  faltante: number | null;
  /** Resultado de merma; `null` si el corte no esta hecho. */
  resultadoMerma: number | null;
}

export interface TotalesCorte {
  cargadas: number;
  vendidas: number;
  regaladas: number;
  mermaEntregada: number;
  mermaRecibida: number;
  mermaAlmacen: number;
  consumo: number;
  cambiosEntregados: number;
  cambiosRecibidos: number;
  deberiaRegresar: number;
  mermaTeorica: number;
  buenas: number;
  merma: number;
  /**
   * Piezas que faltan (D1): suma por tamano de los totales de tamano positivos.
   * `null` si no esta hecho.
   */
  faltante: number | null;
  /** Lo mismo para la merma. */
  faltanteMerma: number | null;
}

/**
 * Piezas teoricas por regresar (C3) = cargadas − vendidas − regaladas −
 * merma entregada − merma de almacen − consumo − cambios entregados +
 * cambios recibidos. No se recorta a 0.
 */
export function deberiaRegresar(
  m: Pick<
    MovimientoPresentacion,
    | 'cargadas'
    | 'vendidas'
    | 'regaladas'
    | 'mermaEntregada'
    | 'mermaAlmacen'
    | 'consumo'
    | 'cambiosEntregados'
    | 'cambiosRecibidos'
  >,
): number {
  return (
    m.cargadas -
    m.vendidas -
    m.regaladas -
    m.mermaEntregada -
    m.mermaAlmacen -
    m.consumo -
    m.cambiosEntregados +
    m.cambiosRecibidos
  );
}

/** Merma teorica por regresar (C4) = merma recibida del cliente + merma de almacen. */
export function mermaTeorica(
  m: Pick<MovimientoPresentacion, 'mermaRecibida' | 'mermaAlmacen'>,
): number {
  return m.mermaRecibida + m.mermaAlmacen;
}

/** Clave del tamano (D3): minusculas y sin espacios ("500 ml" = "500ML" = "500ml"). */
export function claveTamano(volumen: string): string {
  return volumen.toLowerCase().replace(/\s+/g, '');
}

/**
 * Mililitros de un volumen ("355 ml" → 355, "1,5 L" → 1500). `null` si no se
 * lee. Se copia al portal (`lib/cortes.ts`): mantenla pura y autocontenida.
 */
export function mililitros(volumen: string): number | null {
  const m = /^(\d+(?:[.,]\d+)?)(ml|l|lt|lts|litro|litros)$/.exec(
    claveTamano(volumen),
  );
  if (!m) return null;
  const numero = Number(m[1].replace(',', '.'));
  return m[2] === 'ml' ? numero : numero * 1000;
}

/** Orden de tamanos (D3): por mililitros; lo ilegible al final, por texto. */
export function compararTamano(a: string, b: string): number {
  const ma = mililitros(a);
  const mb = mililitros(b);
  if (ma !== null && mb !== null) return ma - mb;
  if (ma !== null) return -1;
  if (mb !== null) return 1;
  return claveTamano(a).localeCompare(claveTamano(b), 'es');
}

/**
 * Faltante del dia (D1): dentro de un tamano los resultados se compensan (C6);
 * entre tamanos no. Suma por tamano de max(0, suma con signo). `null` cuenta 0.
 */
export function faltanteDelDia(
  lineas: readonly { volumen: string; valor: number | null }[],
): number {
  const porTamano = new Map<string, number>();
  for (const l of lineas) {
    const clave = claveTamano(l.volumen);
    porTamano.set(clave, (porTamano.get(clave) ?? 0) + (l.valor ?? 0));
  }
  let total = 0;
  for (const suma of porTamano.values()) total += Math.max(0, suma);
  return total;
}

/**
 * Lo que el vendedor todavia trae en la camioneta, por presentacion: la MISMA
 * cuenta que "teoricas por regresar" (`deberiaRegresar`), en vivo. La usa la
 * venta del portal para no venderle a un vendedor mas de lo que trae cargado
 * (con `sucursal.control_inventario` prendida, como la app de T-27). Descuenta
 * merma entregada, merma de almacen y consumo; la merma recibida NO suma.
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

/** Sin corte, hecho, o hecho con faltante de piezas o de merma. */
export function estadoCorte(
  hecho: boolean,
  totales: Pick<TotalesCorte, 'faltante' | 'faltanteMerma'>,
): EstadoCorte {
  if (!hecho) return 'sin_corte';
  return (totales.faltante ?? 0) > 0 || (totales.faltanteMerma ?? 0) > 0
    ? 'con_faltante'
    : 'hecho';
}

/**
 * El corte de un vendedor y un dia: lineas (ordenadas por tamano, producto y
 * presentacion) con la cuenta, totales y estado.
 */
export function armarCorte(
  movimientos: readonly MovimientoPresentacion[],
  hecho: boolean,
): { lineas: LineaCorte[]; totales: TotalesCorte; estado: EstadoCorte } {
  const lineas: LineaCorte[] = movimientos
    .map((m) => {
      const deberia = deberiaRegresar(m);
      const teoricaMerma = mermaTeorica(m);
      return {
        ...m,
        deberiaRegresar: deberia,
        mermaTeorica: teoricaMerma,
        faltante: faltante(deberia, m.buenas, hecho),
        resultadoMerma: hecho ? teoricaMerma - m.merma : null,
      };
    })
    .sort(
      (a, b) =>
        compararTamano(a.volumen, b.volumen) ||
        a.producto.localeCompare(b.producto, 'es') ||
        a.presentacionId.localeCompare(b.presentacionId),
    );
  const suma = (
    campo: Exclude<keyof TotalesCorte, 'faltante' | 'faltanteMerma'>,
  ) => lineas.reduce((total, l) => total + l[campo], 0);
  const totales: TotalesCorte = {
    cargadas: suma('cargadas'),
    vendidas: suma('vendidas'),
    regaladas: suma('regaladas'),
    mermaEntregada: suma('mermaEntregada'),
    mermaRecibida: suma('mermaRecibida'),
    mermaAlmacen: suma('mermaAlmacen'),
    consumo: suma('consumo'),
    cambiosEntregados: suma('cambiosEntregados'),
    cambiosRecibidos: suma('cambiosRecibidos'),
    deberiaRegresar: suma('deberiaRegresar'),
    mermaTeorica: suma('mermaTeorica'),
    buenas: suma('buenas'),
    merma: suma('merma'),
    faltante: hecho
      ? faltanteDelDia(
          lineas.map((l) => ({ volumen: l.volumen, valor: l.faltante })),
        )
      : null,
    faltanteMerma: hecho
      ? faltanteDelDia(
          lineas.map((l) => ({ volumen: l.volumen, valor: l.resultadoMerma })),
        )
      : null,
  };
  return { lineas, totales, estado: estadoCorte(hecho, totales) };
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
