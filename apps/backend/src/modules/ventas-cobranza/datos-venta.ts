import { montoTotalCentavos, type ContadoCredito } from './reglas-venta';

/**
 * Validacion y normalizacion de `datos` de una venta (T-16, D12).
 *
 * Pura, sin base de datos: decide si la venta tiene la FORMA correcta. Lo que
 * necesita consultar (que la presentacion se venda, que haya precio) lo decide
 * `VentasService` dentro de la transaccion.
 *
 * Recibe un objeto sin tipar y no un DTO: el JSON viene de una tablet que lleva
 * meses capturando offline, y la regla de T-07 es rechazar **por operacion** con
 * un motivo, nunca tumbar el lote. Por eso tambien comprueba lo que haria
 * reventar a Postgres (un uuid mal formado, un entero que no cabe): eso seria un
 * 500 para todo el lote, y la tablet traduce un 5xx a "sin red" y reintentaria
 * para siempre en silencio.
 */

/** Desde la tablet solo estos dos: el numero de factura lo asigna el portal (D9). */
export type FacturaVenta = 'N/A' | 'pendiente';

export interface LineaVentaNormalizada {
  /** uuid en minusculas. */
  presentacionId: string;
  cantidad: number;
  cantidadPromocion: number;
  /** El de la nota firmada (D2). 0 solo en lineas de pura promocion. */
  precioCentavos: number;
}

/** La venta ya validada. El folio no va aqui: viaja en el `contexto` de `registrarVenta`. */
export interface VentaNormalizada {
  clienteId: string;
  numNota: string;
  contadoCredito: ContadoCredito;
  factura: FacturaVenta;
  comentarios: string | null;
  lineas: LineaVentaNormalizada[];
}

export type ResultadoDatosVenta =
  | { ok: true; venta: VentaNormalizada }
  | {
      ok: false;
      /** El campo que fallo, p. ej. `lineas[2].cantidad`. */
      campo: string;
      /** Empieza por `campo`: es lo que guarda la tablet en `sync_error`. */
      motivo: string;
    };

export const MAX_LINEAS_VENTA = 50;
export const LARGO_MAX_NUM_NOTA = 30;
export const LARGO_MAX_COMENTARIOS = 500;

/** `integer` de Postgres: lo que cabe en `cantidad` y `cantidad_promocion`. */
const MAX_ENTERO_POSTGRES = 2_147_483_647;
/** `numeric(12,2)` expresado en centavos: lo que cabe en `precio` y `monto_total`. */
const MAX_CENTAVOS = 999_999_999_999;

const RE_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function invalido(campo: string, motivo: string): ResultadoDatosVenta {
  return { ok: false, campo, motivo: `${campo}: ${motivo}` };
}

/** Entero entre 0 y `maximo`, o `null`. `'24'` no cuenta: el contrato manda numeros. */
function enteroEnRango(valor: unknown, maximo: number): number | null {
  return typeof valor === 'number' &&
    Number.isInteger(valor) &&
    valor >= 0 &&
    valor <= maximo
    ? valor
    : null;
}

function esUnoDe<T extends string>(
  valor: unknown,
  opciones: readonly T[],
): valor is T {
  return (
    typeof valor === 'string' && (opciones as readonly string[]).includes(valor)
  );
}

export function normalizarDatosVenta(
  clienteId: string | null,
  datos: Record<string, unknown>,
): ResultadoDatosVenta {
  // `cliente_id` viaja en el sobre, no en `datos`, pero una venta sin cliente
  // no es una venta. Su formato de uuid ya lo comprobo `normalizarOperacion`.
  if (clienteId === null) {
    return invalido(
      'cliente_id',
      'una venta necesita el cliente al que se le vende.',
    );
  }

  const numNotaCruda = datos.num_nota;
  const numNota = typeof numNotaCruda === 'string' ? numNotaCruda.trim() : '';
  if (numNota === '') {
    return invalido(
      'num_nota',
      'es obligatorio: es el numero de la nota fisica.',
    );
  }
  if (numNota.length > LARGO_MAX_NUM_NOTA) {
    return invalido(
      'num_nota',
      `no puede pasar de ${LARGO_MAX_NUM_NOTA} caracteres.`,
    );
  }

  const contadoCredito = datos.contado_credito;
  if (!esUnoDe(contadoCredito, ['contado', 'credito'] as const)) {
    return invalido('contado_credito', 'debe ser "contado" o "credito".');
  }

  // `N/A` es el valor por defecto de [[Venta-Nota]]: ausente es N/A (D9).
  const factura = datos.factura ?? 'N/A';
  if (!esUnoDe(factura, ['N/A', 'pendiente'] as const)) {
    return invalido(
      'factura',
      'desde la tablet solo puede ser "N/A" o "pendiente"; el numero lo asigna el portal.',
    );
  }

  const comentariosCrudos = datos.comentarios;
  let comentarios: string | null = null;
  if (comentariosCrudos !== undefined && comentariosCrudos !== null) {
    if (typeof comentariosCrudos !== 'string') {
      return invalido('comentarios', 'debe ser texto.');
    }
    const recortados = comentariosCrudos.trim();
    if (recortados.length > LARGO_MAX_COMENTARIOS) {
      return invalido(
        'comentarios',
        `no puede pasar de ${LARGO_MAX_COMENTARIOS} caracteres.`,
      );
    }
    comentarios = recortados === '' ? null : recortados;
  }

  const crudas = datos.lineas;
  if (!Array.isArray(crudas) || crudas.length === 0) {
    return invalido('lineas', 'la venta necesita al menos una linea.');
  }
  if (crudas.length > MAX_LINEAS_VENTA) {
    return invalido(
      'lineas',
      `no puede traer mas de ${MAX_LINEAS_VENTA} lineas.`,
    );
  }

  const lineas: LineaVentaNormalizada[] = [];
  const presentacionesVistas = new Set<string>();

  for (const [indice, cruda] of (crudas as unknown[]).entries()) {
    const campo = `lineas[${indice}]`;
    if (typeof cruda !== 'object' || cruda === null || Array.isArray(cruda)) {
      return invalido(campo, 'debe ser un objeto.');
    }
    const linea = cruda as Record<string, unknown>;

    const presentacion = linea.presentacion_id;
    if (typeof presentacion !== 'string' || !RE_UUID.test(presentacion)) {
      return invalido(
        `${campo}.presentacion_id`,
        'debe ser el identificador de una presentacion.',
      );
    }
    // En minusculas: Postgres compara uuid sin importar mayusculas, asi que
    // `ABC...` y `abc...` son la misma presentacion y chocarian con
    // `uq_venta_detalle_presentacion`: un 500 en vez de un rechazo.
    const presentacionId = presentacion.toLowerCase();
    if (presentacionesVistas.has(presentacionId)) {
      return invalido(
        `${campo}.presentacion_id`,
        'esa presentacion ya viene en otra linea de esta venta.',
      );
    }
    presentacionesVistas.add(presentacionId);

    const cantidad = enteroEnRango(linea.cantidad, MAX_ENTERO_POSTGRES);
    if (cantidad === null) {
      return invalido(
        `${campo}.cantidad`,
        'debe ser un entero de piezas mayor o igual a 0.',
      );
    }
    const cantidadPromocion = enteroEnRango(
      linea.cantidad_promocion,
      MAX_ENTERO_POSTGRES,
    );
    if (cantidadPromocion === null) {
      return invalido(
        `${campo}.cantidad_promocion`,
        'debe ser un entero de piezas mayor o igual a 0.',
      );
    }
    if (cantidad === 0 && cantidadPromocion === 0) {
      return invalido(
        campo,
        'cantidad y cantidad_promocion no pueden ser las dos 0.',
      );
    }

    const precioCentavos = enteroEnRango(linea.precio_centavos, MAX_CENTAVOS);
    if (precioCentavos === null) {
      return invalido(
        `${campo}.precio_centavos`,
        'debe ser un entero de centavos mayor o igual a 0.',
      );
    }
    // 0 solo en lineas de pura promocion (D13). Vender piezas a $0 es regalar,
    // y regalar va en `cantidad_promocion`.
    if (cantidad > 0 && precioCentavos === 0) {
      return invalido(
        `${campo}.precio_centavos`,
        'una linea con piezas vendidas no puede ir a precio 0; las regaladas van en cantidad_promocion.',
      );
    }

    lineas.push({
      presentacionId,
      cantidad,
      cantidadPromocion,
      precioCentavos,
    });
  }

  if (montoTotalCentavos(lineas) > MAX_CENTAVOS) {
    return invalido(
      'lineas',
      'el monto total no cabe en la base (numeric(12,2)).',
    );
  }

  return {
    ok: true,
    venta: { clienteId, numNota, contadoCredito, factura, comentarios, lineas },
  };
}
