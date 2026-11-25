import { esInstante } from '../rutas/datos-jornada';
import { RE_UUID } from '../rutas/datos-visita';

/**
 * Validacion y normalizacion de `datos` de un movimiento de inventario (T-27
 * pieza 2): la merma del cliente, la merma del trayecto y el consumo propio. El
 * rediseño (pieza 4) suma el cambio fisico con un cliente y el motivo de merma.
 *
 * Pura, sin base: decide la FORMA. Que las presentaciones existan y que el id
 * este libre lo decide `MovimientosService` dentro de la transaccion; el
 * `cliente_id` va en el sobre y lo revisa `despacho-movimiento.ts`. Comprueba lo
 * que haria reventar a Postgres (un uuid mal formado, unas piezas que no caben,
 * una linea repetida que choca con `uq_movimiento_linea`): un 500 tumba el lote
 * y la tablet reintentaria para siempre.
 *
 * **No** revisa el limite de consumo ni la existencia (D4, D5): las piezas ya
 * salieron de la camioneta; eso lo exige la tablet.
 */

export const TIPOS_MOVIMIENTO = [
  'merma_cliente',
  'merma_trayecto',
  'consumo',
  /** Rediseño pieza 4: lo recibido regresa al inventario, lo entregado sale. */
  'cambio',
] as const;
export type TipoMovimiento = (typeof TIPOS_MOVIMIENTO)[number];

/** `recibido` = entra a la camioneta (merma del cliente, cambio); `entregado` = sale. */
export const SENTIDOS_MOVIMIENTO = ['recibido', 'entregado'] as const;
export type SentidoMovimiento = (typeof SENTIDOS_MOVIMIENTO)[number];

export const MAX_PIEZAS_MOVIMIENTO = 99_999;
/** Holgado: una linea por presentacion y sentido; el catalogo tiene decenas. */
export const MAX_LINEAS_MOVIMIENTO = 200;
export const LARGO_MAX_COMENTARIO_MOVIMIENTO = 300;

export interface LineaMovimientoNormalizada {
  /** uuid en minusculas. */
  presentacionId: string;
  sentido: SentidoMovimiento;
  piezas: number;
}

/** El movimiento ya validado. Id, vendedor, sucursal, cliente y fecha viajan en el contexto. */
export interface MovimientoNormalizado {
  tipo: TipoMovimiento;
  comentario: string | null;
  /**
   * uuid en minusculas del `motivo_merma`, solo en mermas. `null` = sin motivo
   * (una tablet vieja; la app nueva lo exige). Que exista lo decide el servicio.
   */
  motivoMermaId: string | null;
  /** ISO-8601 en UTC (`toISOString`). */
  registradoEn: string;
  lineas: LineaMovimientoNormalizada[];
}

export type ResultadoDatosMovimiento =
  | { ok: true; movimiento: MovimientoNormalizado }
  /** El `motivo` empieza por el campo: es lo que guarda la tablet en `sync_error`. */
  | { ok: false; motivo: string };

function esTipo(valor: unknown): valor is TipoMovimiento {
  return (
    typeof valor === 'string' &&
    (TIPOS_MOVIMIENTO as readonly string[]).includes(valor)
  );
}

function esSentido(valor: unknown): valor is SentidoMovimiento {
  return (
    typeof valor === 'string' &&
    (SENTIDOS_MOVIMIENTO as readonly string[]).includes(valor)
  );
}

/** Valida y normaliza `datos` de una operacion `movimiento`. */
export function normalizarDatosMovimiento(
  datos: Record<string, unknown>,
): ResultadoDatosMovimiento {
  const tipo = datos.tipo;
  if (!esTipo(tipo)) {
    return {
      ok: false,
      motivo:
        'tipo: tiene que ser merma_cliente, merma_trayecto, consumo o cambio.',
    };
  }

  const registradoEn = datos.registrado_en;
  if (!esInstante(registradoEn)) {
    return {
      ok: false,
      motivo:
        'registrado_en: tiene que ser un instante ISO-8601 con zona (por ejemplo 2026-10-23T18:40:00Z).',
    };
  }

  let comentario: string | null = null;
  const crudo = datos.comentario;
  if (crudo !== undefined && crudo !== null) {
    if (typeof crudo !== 'string') {
      return { ok: false, motivo: 'comentario: tiene que ser texto o null.' };
    }
    const limpio = crudo.trim();
    if (limpio.length > LARGO_MAX_COMENTARIO_MOVIMIENTO) {
      return {
        ok: false,
        motivo: `comentario: no puede pasar de ${LARGO_MAX_COMENTARIO_MOVIMIENTO} caracteres.`,
      };
    }
    comentario = limpio === '' ? null : limpio;
  }

  // Decision 1 del plan: opcional (tablets viejas), solo en mermas.
  let motivoMermaId: string | null = null;
  const motivoCrudo = datos.motivo_merma_id;
  if (motivoCrudo !== undefined && motivoCrudo !== null) {
    if (typeof motivoCrudo !== 'string' || !RE_UUID.test(motivoCrudo)) {
      return {
        ok: false,
        motivo:
          'motivo_merma_id: tiene que ser el uuid de un motivo de merma o null.',
      };
    }
    if (tipo !== 'merma_cliente' && tipo !== 'merma_trayecto') {
      return {
        ok: false,
        motivo:
          'motivo_merma_id: solo la merma del cliente y la del trayecto llevan motivo; el cambio y el consumo no.',
      };
    }
    motivoMermaId = motivoCrudo.toLowerCase();
  }

  const crudas: unknown = datos.lineas;
  if (
    !Array.isArray(crudas) ||
    crudas.length === 0 ||
    crudas.length > MAX_LINEAS_MOVIMIENTO
  ) {
    return {
      ok: false,
      motivo: `lineas: tiene que ser una lista de 1 a ${MAX_LINEAS_MOVIMIENTO} líneas.`,
    };
  }

  const lista: unknown[] = crudas;
  const lineas: LineaMovimientoNormalizada[] = [];
  const vistas = new Set<string>();
  for (const [i, cruda] of lista.entries()) {
    const campo = `lineas[${i}]`;
    if (typeof cruda !== 'object' || cruda === null || Array.isArray(cruda)) {
      return { ok: false, motivo: `${campo}: tiene que ser un objeto.` };
    }
    const l = cruda as Record<string, unknown>;

    const presentacion = l.presentacion_id;
    if (typeof presentacion !== 'string' || !RE_UUID.test(presentacion)) {
      return {
        ok: false,
        motivo: `${campo}.presentacion_id: tiene que ser el uuid de una presentación.`,
      };
    }
    const sentido = l.sentido;
    if (!esSentido(sentido)) {
      return {
        ok: false,
        motivo: `${campo}.sentido: tiene que ser recibido o entregado.`,
      };
    }
    const piezas = l.piezas;
    if (
      typeof piezas !== 'number' ||
      !Number.isInteger(piezas) ||
      piezas < 1 ||
      piezas > MAX_PIEZAS_MOVIMIENTO
    ) {
      return {
        ok: false,
        motivo: `${campo}.piezas: tiene que ser un entero de 1 a ${MAX_PIEZAS_MOVIMIENTO}.`,
      };
    }

    const presentacionId = presentacion.toLowerCase();
    const llave = `${presentacionId}|${sentido}`;
    if (vistas.has(llave)) {
      // Chocaria con `uq_movimiento_linea` y saldria como 500 para todo el lote.
      return {
        ok: false,
        motivo: `${campo}.presentacion_id: esa presentación ya viene en otra línea ${sentido}.`,
      };
    }
    vistas.add(llave);

    if (
      tipo !== 'merma_cliente' &&
      tipo !== 'cambio' &&
      sentido === 'recibido'
    ) {
      return {
        ok: false,
        motivo: `${campo}.sentido: la merma del trayecto y el consumo solo llevan líneas entregado (piezas que salen de la camioneta).`,
      };
    }
    lineas.push({ presentacionId, sentido, piezas });
  }

  // D2: "Recibí dañado" lleva al menos una pieza; "Le entregué" es opcional.
  if (
    tipo === 'merma_cliente' &&
    !lineas.some((l) => l.sentido === 'recibido')
  ) {
    return {
      ok: false,
      motivo:
        'lineas: una merma del cliente lleva al menos una línea recibido (lo que el cliente devolvió dañado).',
    };
  }

  // Decision 2 del plan: un cambio es un intercambio, recibe y entrega.
  if (tipo === 'cambio') {
    if (!lineas.some((l) => l.sentido === 'recibido')) {
      return {
        ok: false,
        motivo:
          'lineas: un cambio lleva al menos una línea recibido (lo que entregó el cliente).',
      };
    }
    if (!lineas.some((l) => l.sentido === 'entregado')) {
      return {
        ok: false,
        motivo:
          'lineas: un cambio lleva al menos una línea entregado (lo que le entregó el vendedor).',
      };
    }
  }

  return {
    ok: true,
    movimiento: {
      tipo,
      comentario,
      motivoMermaId,
      registradoEn: new Date(registradoEn).toISOString(),
      lineas,
    },
  };
}
