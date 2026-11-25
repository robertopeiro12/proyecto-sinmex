import { esInstante } from './datos-jornada';
import { RE_UUID } from './datos-visita';

/**
 * Validacion y normalizacion de `datos` del corte del vendedor (rediseño pieza
 * 6, spec §13).
 *
 * Pura, sin base de datos. El corte es **informativo**: no mueve saldos,
 * existencias ni el corte de mercancia de la oficina, asi que aqui no se mira
 * que los folios o las presentaciones existan. Solo se rechaza lo que es un bug
 * de la tablet o haria reventar a Postgres: un corte enviado ya no cambia en la
 * tablet, y un rechazo de forma es para siempre.
 */

/** Tope de notas: muy por encima de lo que trae un vendedor en un dia. */
export const MAX_NOTAS_CORTE = 500;
/** Tope de renglones de inventario (uno por presentacion). */
export const MAX_RENGLONES_CORTE = 200;
/** El folio de ADR-0001 mide 12; holgura para uno raro, sin dejar pasar texto libre. */
const LARGO_MAX_FOLIO = 20;

/** El corte ya validado. Id, vendedor, sucursal y fecha viajan en el contexto. */
export interface CorteNormalizado {
  efectivo: {
    /** Lo que el sistema dice que debe traer; puede ser negativo. */
    esperadoCentavos: number;
    traidoCentavos: number;
  };
  notas: { folio: string; traida: boolean; saldoCentavos: number }[];
  inventario: { presentacionId: string; sistema: number; contado: number }[];
  merma: { sistema: number; contado: number };
  /** ISO-8601 en UTC (`toISOString`). */
  enviadoEn: string;
}

export type ResultadoDatosCorte =
  | { ok: true; corte: CorteNormalizado }
  /** El `motivo` empieza por el campo: es lo que guarda la tablet en `sync_error`. */
  | { ok: false; motivo: string };

class Invalido extends Error {}

const falla = (campo: string, motivo: string): never => {
  throw new Invalido(`${campo}: ${motivo}`);
};

const esObjeto = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function objeto(campo: string, v: unknown): Record<string, unknown> {
  if (!esObjeto(v)) falla(campo, 'tiene que ser un objeto.');
  return v as Record<string, unknown>;
}

function arreglo(campo: string, v: unknown, maximo: number): unknown[] {
  if (!Array.isArray(v)) falla(campo, 'tiene que ser una lista.');
  const lista = v as unknown[];
  if (lista.length > maximo) falla(campo, `no puede traer mas de ${maximo}.`);
  return lista;
}

function entero(campo: string, v: unknown): number {
  if (!Number.isSafeInteger(v)) falla(campo, 'tiene que ser un numero entero.');
  return v as number;
}

function cantidad(campo: string, v: unknown): number {
  const n = entero(campo, v);
  if (n < 0) falla(campo, 'tiene que ser un entero mayor o igual a cero.');
  return n;
}

function normalizar(datos: Record<string, unknown>): CorteNormalizado {
  const efectivo = objeto('efectivo', datos.efectivo);
  const esperadoCentavos = entero(
    'efectivo.esperado_centavos',
    efectivo.esperado_centavos,
  );
  const traidoCentavos = cantidad(
    'efectivo.traido_centavos',
    efectivo.traido_centavos,
  );

  const notas = arreglo('notas', datos.notas, MAX_NOTAS_CORTE).map(
    (crudo, i) => {
      const n = objeto(`notas[${i}]`, crudo);
      const folio = typeof n.folio === 'string' ? n.folio.trim() : '';
      if (folio === '' || folio.length > LARGO_MAX_FOLIO) {
        falla(
          `notas[${i}].folio`,
          `tiene que ser texto de 1 a ${LARGO_MAX_FOLIO} caracteres.`,
        );
      }
      if (typeof n.traida !== 'boolean')
        falla(`notas[${i}].traida`, 'tiene que ser true o false.');
      return {
        folio,
        traida: n.traida as boolean,
        saldoCentavos: cantidad(`notas[${i}].saldo_centavos`, n.saldo_centavos),
      };
    },
  );

  const vistas = new Set<string>();
  const inventario = arreglo(
    'inventario',
    datos.inventario,
    MAX_RENGLONES_CORTE,
  ).map((crudo, i) => {
    const r = objeto(`inventario[${i}]`, crudo);
    const id = r.presentacion_id;
    if (typeof id !== 'string' || !RE_UUID.test(id)) {
      falla(
        `inventario[${i}].presentacion_id`,
        'tiene que ser el uuid de la presentacion.',
      );
    }
    const presentacionId = (id as string).toLowerCase();
    if (vistas.has(presentacionId)) {
      falla(
        `inventario[${i}].presentacion_id`,
        'presentacion repetida; va una sola vez.',
      );
    }
    vistas.add(presentacionId);
    return {
      presentacionId,
      sistema: cantidad(`inventario[${i}].sistema`, r.sistema),
      contado: cantidad(`inventario[${i}].contado`, r.contado),
    };
  });

  const merma = objeto('merma', datos.merma);
  const mermaNormalizada = {
    sistema: cantidad('merma.sistema', merma.sistema),
    contado: cantidad('merma.contado', merma.contado),
  };

  if (!esInstante(datos.enviado_en)) {
    falla(
      'enviado_en',
      'tiene que ser un instante ISO-8601 con zona (por ejemplo 2026-11-26T01:30:00Z).',
    );
  }

  return {
    efectivo: { esperadoCentavos, traidoCentavos },
    notas,
    inventario,
    merma: mermaNormalizada,
    enviadoEn: new Date(datos.enviado_en as string).toISOString(),
  };
}

/** Valida y normaliza `datos` de una operacion `corte`. */
export function normalizarDatosCorte(
  datos: Record<string, unknown>,
): ResultadoDatosCorte {
  try {
    return { ok: true, corte: normalizar(datos) };
  } catch (error) {
    if (error instanceof Invalido) return { ok: false, motivo: error.message };
    throw error;
  }
}
