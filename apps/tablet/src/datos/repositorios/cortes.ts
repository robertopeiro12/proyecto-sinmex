import type { DepsRepositorio } from './deps';
import { enTransaccion } from './deps';
import type { FechaISO, Jornada, MomentoISO, SyncEstado } from '../tipos';

/**
 * El corte del vendedor en la tablet (rediseño pieza 6, spec §13; migracion 023).
 *
 * Una fila por jornada. Mientras el vendedor captura es un **borrador**
 * (`enviado_en` nulo) que sobrevive a cerrar la pantalla o la app. Al enviar,
 * `jornadas.cerrarConCorte` guarda lo capturado **y lo que decia el sistema** y
 * cierra la jornada en una sola transaccion; desde ahi el corte no cambia y es
 * lo que sube al servidor (la fuente del push es la Task 3).
 *
 * La capa de datos no importa de `@/estado`: las formas de lo que dice el
 * sistema se declaran aqui y son las que regresan las reglas puras de
 * `src/estado/corte.ts` (una prueba de tipos en `cortes.spec.ts` lo amarra).
 */

/** Error de regla de negocio del corte (no un fallo tecnico de SQLite). */
export class ErrorCorte extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'ErrorCorte';
  }
}

export type ApartadoCorte = 'efectivo' | 'notas' | 'inventario';
const APARTADOS_CORTE: readonly ApartadoCorte[] = ['efectivo', 'notas', 'inventario'];

/** Lo que captura el vendedor en la pantalla del corte. */
export interface CapturaCorte {
  /** Efectivo que trae, en centavos; `null` = aun no lo escribe. */
  efectivoTraidoCentavos: number | null;
  /** Claves (`nota:<folio>`) de las notas que palomeo como traidas. */
  notasTraidas: string[];
  /** Piezas buenas contadas, por `presentacionId`. Sin llave = no la ha contado. */
  inventarioContado: Record<string, number>;
  /** Merma contada (un solo total); `null` = aun no la cuenta. */
  mermaContada: number | null;
  /** Apartados que el vendedor ya cerro. */
  cerrados: ApartadoCorte[];
}

/** = `EfectivoEsperado` de `src/estado/corte.ts`. */
export interface EfectivoSistemaCorte {
  contadoCentavos: number;
  abonosCentavos: number;
  cobrosEfectivoCentavos: number;
  abonosYCobrosCentavos: number;
  gastosCentavos: number;
  debeTraerCentavos: number;
  otrosMetodosCentavos: number;
}

/** = `RenglonNotaCorte` de `src/estado/corte.ts`. */
export interface NotaSistemaCorte {
  clave: string;
  folio: string;
  cliente: string;
  estado: 'liquidada' | 'abonó' | 'nueva' | 'pendiente';
  detalle: string;
  montoTexto: string;
  saldoCentavos: number;
}

/** = `InventarioDelCorte` de `src/estado/corte.ts`. */
export interface InventarioSistemaCorte {
  renglones: { presentacionId: string; etiqueta: string; sistema: number }[];
  mermaSistema: number;
}

/** Lo que decia el sistema al enviar el corte. */
export interface SistemaCorte {
  efectivo: EfectivoSistemaCorte;
  notas: NotaSistemaCorte[];
  inventario: InventarioSistemaCorte;
}

/** Lo que recibe `jornadas.cerrarConCorte`. */
export interface CorteParaEnviar {
  captura: CapturaCorte;
  sistema: SistemaCorte;
}

/** El borrador que la pantalla vuelve a pintar. */
export interface CorteBorrador extends CapturaCorte {
  id: string;
  jornadaId: string;
}

/** Un corte leido de la base, borrador o enviado. */
export interface Corte {
  /** = clave de idempotencia del push. */
  id: string;
  jornadaId: string;
  fecha: FechaISO;
  vendedorId: string;
  captura: CapturaCorte;
  /** `null` en un borrador. */
  sistema: SistemaCorte | null;
  /** `null` = borrador. */
  enviadoEn: MomentoISO | null;
  syncEstado: SyncEstado;
  syncError: string | null;
  sincronizadoEn: MomentoISO | null;
}

interface FilaCorte {
  id: string;
  jornada_id: string;
  fecha: FechaISO;
  vendedor_id: string;
  efectivo_json: string;
  notas_json: string;
  inventario_json: string;
  cerrados_json: string;
  enviado_en: MomentoISO | null;
  sync_estado: SyncEstado;
  sync_error: string | null;
  sincronizado_en: MomentoISO | null;
}

// --------------------------------------------------------------------------
// Forma de las columnas JSON:
//   efectivo_json   { traidoCentavos: number|null, sistema?: EfectivoSistemaCorte }
//   notas_json      { traidas: string[], sistema?: NotaSistemaCorte[] }
//   inventario_json { contado: {[presentacionId]: number}, mermaContada: number|null,
//                     sistema?: InventarioSistemaCorte }
//   cerrados_json   ApartadoCorte[]
// `sistema` solo existe en un corte enviado.
// --------------------------------------------------------------------------

function leerJson(texto: string): unknown {
  try {
    return JSON.parse(texto) as unknown;
  } catch {
    return null;
  }
}

const esObjeto = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const esCantidad = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;

const cantidadONulo = (v: unknown): number | null => (esCantidad(v) ? v : null);

const sinRepetidos = <T>(valores: readonly T[]): T[] => [...new Set(valores)];

/** Lectura tolerante (como `leerReparto`): un JSON roto o ajeno da lo vacio. */
function aCorte(fila: FilaCorte): Corte {
  const efectivo = leerJson(fila.efectivo_json);
  const notas = leerJson(fila.notas_json);
  const inventario = leerJson(fila.inventario_json);
  const cerrados = leerJson(fila.cerrados_json);

  const contado: Record<string, number> = {};
  if (esObjeto(inventario) && esObjeto(inventario.contado)) {
    for (const [id, piezas] of Object.entries(inventario.contado)) {
      if (esCantidad(piezas)) contado[id] = piezas;
    }
  }

  const captura: CapturaCorte = {
    efectivoTraidoCentavos: esObjeto(efectivo) ? cantidadONulo(efectivo.traidoCentavos) : null,
    notasTraidas:
      esObjeto(notas) && Array.isArray(notas.traidas)
        ? notas.traidas.filter((c): c is string => typeof c === 'string')
        : [],
    inventarioContado: contado,
    mermaContada: esObjeto(inventario) ? cantidadONulo(inventario.mermaContada) : null,
    cerrados: Array.isArray(cerrados)
      ? cerrados.filter((a): a is ApartadoCorte => APARTADOS_CORTE.includes(a as ApartadoCorte))
      : [],
  };

  const sistema: SistemaCorte | null =
    fila.enviado_en !== null &&
    esObjeto(efectivo) &&
    esObjeto(notas) &&
    esObjeto(inventario) &&
    efectivo.sistema !== undefined &&
    notas.sistema !== undefined &&
    inventario.sistema !== undefined
      ? {
          efectivo: efectivo.sistema as EfectivoSistemaCorte,
          notas: notas.sistema as NotaSistemaCorte[],
          inventario: inventario.sistema as InventarioSistemaCorte,
        }
      : null;

  return {
    id: fila.id,
    jornadaId: fila.jornada_id,
    fecha: fila.fecha,
    vendedorId: fila.vendedor_id,
    captura,
    sistema,
    enviadoEn: fila.enviado_en,
    syncEstado: fila.sync_estado,
    syncError: fila.sync_error,
    sincronizadoEn: fila.sincronizado_en,
  };
}

/** Valida y normaliza (sin repetidos) una captura completa. */
function validarCaptura(captura: CapturaCorte): CapturaCorte {
  if (captura.efectivoTraidoCentavos !== null && !esCantidad(captura.efectivoTraidoCentavos)) {
    throw new ErrorCorte('El efectivo que traes debe ser una cantidad mayor o igual a cero.');
  }
  if (captura.mermaContada !== null && !esCantidad(captura.mermaContada)) {
    throw new ErrorCorte('La merma contada debe ser un número entero mayor o igual a cero.');
  }
  for (const piezas of Object.values(captura.inventarioContado)) {
    if (!esCantidad(piezas)) {
      throw new ErrorCorte('Las piezas contadas deben ser un número entero mayor o igual a cero.');
    }
  }
  if (!captura.notasTraidas.every((c) => typeof c === 'string')) {
    throw new ErrorCorte('Nota traída no válida.');
  }
  if (!captura.cerrados.every((a) => APARTADOS_CORTE.includes(a))) {
    throw new ErrorCorte('Apartado del corte no válido.');
  }
  return {
    efectivoTraidoCentavos: captura.efectivoTraidoCentavos,
    notasTraidas: sinRepetidos(captura.notasTraidas),
    inventarioContado: { ...captura.inventarioContado },
    mermaContada: captura.mermaContada,
    cerrados: sinRepetidos(captura.cerrados),
  };
}

const CAPTURA_VACIA: CapturaCorte = {
  efectivoTraidoCentavos: null,
  notasTraidas: [],
  inventarioContado: {},
  mermaContada: null,
  cerrados: [],
};

function filaDeJornada(bd: DepsRepositorio['bd'], jornadaId: string): FilaCorte | null {
  return bd.getFirstSync<FilaCorte>('select * from corte where jornada_id = $jornada_id', {
    $jornada_id: jornadaId,
  });
}

/**
 * Escribe la fila del corte de la jornada (la crea con un id nuevo o conserva
 * el del borrador). **Sin transaccion propia**: la ponen sus llamadores.
 */
function escribir(
  { bd, generarId }: Pick<DepsRepositorio, 'bd' | 'generarId'>,
  jornada: Pick<Jornada, 'id' | 'fecha' | 'vendedor_id'>,
  captura: CapturaCorte,
  envio: { sistema: SistemaCorte; enviadoEn: MomentoISO } | null,
): void {
  const valores = {
    $efectivo_json: JSON.stringify({
      traidoCentavos: captura.efectivoTraidoCentavos,
      ...(envio ? { sistema: envio.sistema.efectivo } : {}),
    }),
    $notas_json: JSON.stringify({
      traidas: captura.notasTraidas,
      ...(envio ? { sistema: envio.sistema.notas } : {}),
    }),
    $inventario_json: JSON.stringify({
      contado: captura.inventarioContado,
      mermaContada: captura.mermaContada,
      ...(envio ? { sistema: envio.sistema.inventario } : {}),
    }),
    $cerrados_json: JSON.stringify(captura.cerrados),
    $enviado_en: envio?.enviadoEn ?? null,
  };

  const existente = filaDeJornada(bd, jornada.id);
  if (existente) {
    bd.runSync(
      `update corte set
         efectivo_json = $efectivo_json, notas_json = $notas_json,
         inventario_json = $inventario_json, cerrados_json = $cerrados_json,
         enviado_en = $enviado_en
       where id = $id`,
      { ...valores, $id: existente.id },
    );
    return;
  }
  bd.runSync(
    `insert into corte (id, jornada_id, fecha, vendedor_id, efectivo_json, notas_json,
                        inventario_json, cerrados_json, enviado_en)
     values ($id, $jornada_id, $fecha, $vendedor_id, $efectivo_json, $notas_json,
             $inventario_json, $cerrados_json, $enviado_en)`,
    {
      ...valores,
      $id: generarId(),
      $jornada_id: jornada.id,
      $fecha: jornada.fecha,
      $vendedor_id: jornada.vendedor_id,
    },
  );
}

/**
 * Guarda el corte **enviado** de una jornada que se esta cerrando. La llama
 * `jornadas.cerrarConCorte` dentro de su transaccion (por eso no abre una
 * propia: `enTransaccion` no se anida). Exige los tres apartados cerrados.
 */
export function guardarCorteEnviado(
  deps: Pick<DepsRepositorio, 'bd' | 'reloj' | 'generarId'>,
  jornada: Pick<Jornada, 'id' | 'fecha' | 'vendedor_id'>,
  corte: CorteParaEnviar,
): Corte {
  const captura = validarCaptura(corte.captura);
  if (!APARTADOS_CORTE.every((a) => captura.cerrados.includes(a))) {
    throw new ErrorCorte('Cierra los tres apartados antes de enviar el corte.');
  }
  const previo = filaDeJornada(deps.bd, jornada.id);
  if (previo?.enviado_en) throw new ErrorCorte('El corte ya se envió.');

  escribir(deps, jornada, captura, { sistema: corte.sistema, enviadoEn: deps.reloj.ahora() });
  const fila = filaDeJornada(deps.bd, jornada.id);
  if (!fila) throw new ErrorCorte('No se pudo leer el corte recién enviado.');
  return aCorte(fila);
}

export type RepositorioCortes = ReturnType<typeof crearRepositorioCortes>;

export function crearRepositorioCortes(deps: DepsRepositorio) {
  const { bd, reloj } = deps;

  return {
    /** El borrador de la jornada, o `null` si no hay o ya se envio. */
    borrador(jornadaId: string): CorteBorrador | null {
      const fila = filaDeJornada(bd, jornadaId);
      if (!fila || fila.enviado_en !== null) return null;
      return { id: fila.id, jornadaId: fila.jornada_id, ...aCorte(fila).captura };
    },

    /**
     * Guarda lo que el vendedor lleva capturado. Solo cambia las llaves que se
     * mandan; lo demas se conserva. Falla sin jornada, con el dia ya cerrado o
     * con el corte ya enviado (un guardado tardio de la pantalla no puede
     * alterar lo que ya se mando).
     */
    guardarBorrador(jornadaId: string, parcial: Partial<CapturaCorte>): CorteBorrador {
      return enTransaccion(bd, () => {
        const jornada = bd.getFirstSync<Jornada>('select * from jornada where id = $id', { $id: jornadaId });
        if (!jornada) throw new ErrorCorte(`No existe la jornada ${jornadaId}.`);
        const fila = filaDeJornada(bd, jornadaId);
        if (fila?.enviado_en) throw new ErrorCorte('El corte ya se envió.');
        if (jornada.estado === 'cerrada') throw new ErrorCorte('El día ya está cerrado.');

        const previa = fila ? aCorte(fila).captura : CAPTURA_VACIA;
        const captura = validarCaptura({ ...previa, ...parcial });
        escribir(deps, jornada, captura, null);

        const guardada = filaDeJornada(bd, jornadaId);
        if (!guardada) throw new ErrorCorte('No se pudo leer el borrador del corte.');
        return { id: guardada.id, jornadaId, ...aCorte(guardada).captura };
      });
    },

    /** El corte de hoy del vendedor (borrador o enviado), o `null`. */
    deHoy(vendedorId: string): Corte | null {
      const fila = bd.getFirstSync<FilaCorte>(
        'select * from corte where vendedor_id = $vendedor_id and fecha = $fecha',
        { $vendedor_id: vendedorId, $fecha: reloj.hoy() },
      );
      return fila ? aCorte(fila) : null;
    },

    /**
     * Cortes **enviados** que faltan por subir, incluidos los rechazados (se
     * reintentan; la clave no cambia). Un borrador nunca sale.
     *
     * Un enviado cuyo JSON ya no se lee (`sistema` nulo, lectura tolerante) no
     * sale: no hay corte que mandar sin inventarlo. Se filtra **aqui** para que
     * la fuente del push y `contarPendientesDeSubir` digan lo mismo (si no, el
     * menu contaria para siempre un registro que nunca sube).
     */
    pendientesDeSincronizar(): Corte[] {
      return bd
        .getAllSync<FilaCorte>(
          `select * from corte
            where enviado_en is not null and sync_estado in ('pendiente', 'error')
            order by fecha, enviado_en, rowid`,
        )
        .map(aCorte)
        .filter((c) => c.sistema !== null && c.enviadoEn !== null);
    },

    marcarSincronizada(id: string): void {
      bd.runSync(
        `update corte set sync_estado = 'sincronizado', sincronizado_en = $en, sync_error = null
          where id = $id`,
        { $en: reloj.ahora(), $id: id },
      );
    },

    marcarError(id: string, motivo: string): void {
      bd.runSync(`update corte set sync_estado = 'error', sync_error = $motivo where id = $id`, {
        $motivo: motivo,
        $id: id,
      });
    },
  };
}
