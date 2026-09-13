import type { ContadoCredito } from './tipos';

/**
 * Reglas de la captura de una venta (T-16), sin SQLite ni React.
 *
 * Las usan **la pantalla** (total en vivo, avisos antes de revisar) y **el
 * repositorio** (que vuelve a validar antes de grabar). Viven en un solo sitio
 * para que la pantalla no pueda dejar pasar algo que el repositorio rechaza, ni
 * al reves. Son el espejo de la validacion del servidor (`datos-venta.ts` del
 * backend): lo que aqui pasa, alla no es `datos-invalidos`.
 */

export const MAX_LINEAS_VENTA = 50;
export const LARGO_MAX_NUM_NOTA = 30;
export const LARGO_MAX_COMENTARIOS = 500;

/**
 * Limites de datos duplicados del servidor (backend/src/modules/ventas-cobranza/datos-venta.ts).
 * La tablet no puede importar del backend (Metro), asi que se duplican a proposito.
 * Sirven para rechazar en la tablet lo que el servidor rechazaria al sincronizar.
 */
const MAX_ENTERO_POSTGRES = 2_147_483_647;
const MAX_CENTAVOS = 999_999_999_999;

/** Una fila de la captura: una presentacion con lo capturado y su precio del catalogo local. */
export interface LineaCaptura {
  presentacionId: string;
  /** Producto y volumen, para decirle al vendedor cual fila esta mal. */
  etiqueta: string;
  cantidad: number;
  cantidadPromocion: number;
  /** Centavos del catalogo local, o `null` si el cliente no tiene precio. */
  precioCentavos: number | null;
}

export interface ResumenLinea extends LineaCaptura {
  importeCentavos: number;
}

export interface ResumenCaptura {
  /** Solo las filas con algo capturado. */
  lineas: ResumenLinea[];
  totalCentavos: number;
  piezas: number;
  piezasPromocion: number;
}

export interface CapturaVenta {
  numNota: string;
  /** `null` mientras el vendedor no elija. */
  contadoCredito: ContadoCredito | null;
  comentarios: string;
  lineas: readonly LineaCaptura[];
}

/**
 * Texto de un campo de cantidad a numero de piezas.
 *
 * Vacio es 0: el vendedor solo llena lo que vende. Cualquier cosa que no sean
 * digitos es `null`: con el teclado numerico casi no pasa, pero un teclado
 * externo o un pegado si, y un "1.5" de piezas no puede volverse 1 en silencio.
 * Rechaza numeros mayores que MAX_ENTERO_POSTGRES.
 */
export function leerCantidad(texto: string): number | null {
  const limpio = texto.trim();
  if (limpio === '') return 0;
  if (!/^\d+$/.test(limpio)) return null;
  const numero = Number(limpio);
  if (!Number.isSafeInteger(numero)) return null;
  if (numero > MAX_ENTERO_POSTGRES) return null;
  return numero;
}

/** Tiene algo capturado. Una cantidad ilegible (`NaN`) no cuenta como capturada. */
function tieneAlgo(l: LineaCaptura): boolean {
  return l.cantidad + l.cantidadPromocion > 0;
}

/**
 * Total en vivo e importe por fila. Las piezas de promocion **no suman** al
 * importe. Una fila sin precio suma 0: solo puede ser de promocion, y si trae
 * cantidad `problemasDeCaptura` lo dice.
 */
export function resumirCaptura(lineas: readonly LineaCaptura[]): ResumenCaptura {
  const conAlgo = lineas.filter(tieneAlgo).map((l) => ({
    ...l,
    importeCentavos: l.cantidad * (l.precioCentavos ?? 0),
  }));
  return {
    lineas: conAlgo,
    totalCentavos: conAlgo.reduce((total, l) => total + l.importeCentavos, 0),
    piezas: conAlgo.reduce((total, l) => total + l.cantidad, 0),
    piezasPromocion: conAlgo.reduce((total, l) => total + l.cantidadPromocion, 0),
  };
}

/**
 * Lo que impide grabar, en el espanol del vendedor. Vacio: se puede grabar.
 *
 * - Cantidades enteras y no negativas.
 * - Al menos una fila con algo, y no mas de 50.
 * - Una fila con piezas vendidas necesita precio mayor que 0: sin el, solo se
 *   puede regalar como promocion. El servidor rechaza piezas vendidas a $0.
 * - Numero de nota obligatorio y de hasta 30; contado o credito elegido;
 *   comentarios de hasta 500.
 */
export function problemasDeCaptura(captura: CapturaVenta): string[] {
  const problemas: string[] = [];

  for (const l of captura.lineas) {
    const enteras =
      Number.isInteger(l.cantidad) &&
      l.cantidad >= 0 &&
      l.cantidad <= MAX_ENTERO_POSTGRES &&
      Number.isInteger(l.cantidadPromocion) &&
      l.cantidadPromocion >= 0 &&
      l.cantidadPromocion <= MAX_ENTERO_POSTGRES;
    if (!enteras) {
      problemas.push(`${l.etiqueta}: las cantidades son piezas enteras.`);
    } else if (l.cantidad > 0 && (l.precioCentavos === null || l.precioCentavos === 0)) {
      problemas.push(
        `${l.etiqueta} no tiene precio para este cliente: solo se puede regalar como promoción.`,
      );
    }
  }

  const conAlgo = captura.lineas.filter(tieneAlgo).length;
  if (conAlgo === 0) {
    problemas.push('Captura al menos una cantidad o una pieza de promoción.');
  }
  if (conAlgo > MAX_LINEAS_VENTA) {
    problemas.push(`Una venta lleva hasta ${MAX_LINEAS_VENTA} productos.`);
  }

  const resumen = resumirCaptura(captura.lineas);
  if (resumen.totalCentavos > MAX_CENTAVOS) {
    problemas.push('El total de la venta es demasiado grande.');
  }

  const numNota = captura.numNota.trim();
  if (numNota === '') {
    problemas.push('Falta el número de la nota física.');
  } else if (numNota.length > LARGO_MAX_NUM_NOTA) {
    problemas.push(`El número de nota lleva hasta ${LARGO_MAX_NUM_NOTA} caracteres.`);
  }

  if (captura.contadoCredito === null) {
    problemas.push('Elige si la venta es de contado o a crédito.');
  }

  if (captura.comentarios.trim().length > LARGO_MAX_COMENTARIOS) {
    problemas.push(`Los comentarios llevan hasta ${LARGO_MAX_COMENTARIOS} caracteres.`);
  }

  return problemas;
}
