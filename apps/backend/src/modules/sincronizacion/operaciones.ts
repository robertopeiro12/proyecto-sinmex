import {
  esTipoConocido,
  type CodigoRechazo,
  type TipoOperacion,
} from './contrato';
import { explicarFolioInvalido, revisarFolio } from './folio';

/**
 * Validacion y normalizacion de **una** operacion del lote de `push`.
 *
 * Es una funcion pura, sin base de datos ni Nest, por dos motivos:
 *
 * 1. Es la pieza que decide qué entra y qué no, y esa decision tiene que poder
 *    probarse entera sin montar Postgres (mismo criterio que `resolverAlcance`
 *    de T-09).
 * 2. Devuelve un **motivo por operacion** en vez de lanzar. Un lote de 50
 *    operaciones con 3 malas tiene que entrar con 47 y decir cuales fallaron:
 *    tumbar la peticion entera dejaria al vendedor sin su dia por un dedazo.
 */

/** Operacion ya validada, lista para guardarse. */
export interface OperacionNormalizada {
  clave: string;
  tipo: TipoOperacion;
  /** Dia de trabajo del vendedor, `AAAA-MM-DD`, calculado por la tablet. */
  fechaOperacion: string;
  /** Instante exacto, ISO-8601 con zona. */
  ocurridoEn: string;
  /** Cliente al que se refiere, si aplica. Se comprueba el alcance contra la BD. */
  clienteId: string | null;
  /**
   * El [[Folios|folio]] que la tablet emitio **offline** para esta operacion,
   * o `null` si su tipo no lleva folio.
   *
   * Hoy la `jornada` (vehiculo + kilometraje) no lo lleva: no es una nota que
   * nadie firme. Venta y cobranza si lo llevaran (T-16/T-20). Por eso es
   * opcional en el contrato y no obligatorio.
   */
  folio: string | null;
  datos: Record<string, unknown>;
}

export type Rechazo = { codigo: CodigoRechazo; motivo: string };

export type ResultadoNormalizacion =
  | { ok: true; operacion: OperacionNormalizada }
  /** El cuerpo atribuye la operacion a OTRO vendedor: no es un rechazo, es un 403. */
  | { ok: 'ajena'; vendedorId: string }
  | ({ ok: false } & Rechazo);

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const LARGO_MAX_CLAVE = 100;

/**
 * Los ids del servidor son `uuid`, y esto se comprueba **antes** de consultar.
 *
 * No es cosmético. `where id in ('no-soy-uuid')` no devuelve cero filas: hace
 * que Postgres reviente con `invalid input syntax for type uuid`, y eso saldría
 * como **500 para todo el lote** — justo el todo-o-nada que este contrato
 * promete no hacer. Peor aún: la tablet traduce un 5xx a "sin red" y
 * reintentaría ese lote para siempre, en silencio.
 *
 * Una fila local con un `cliente_id` corrupto no es un caso teórico: la tablet
 * lleva meses de datos capturados offline y sus ids salen de su propio SQLite.
 */
const RE_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Fecha de hoy en la zona del negocio.
 *
 * > [!danger] La jornada del vendedor NO es un dia UTC
 * > La operacion es de Tijuana. A las 18:00 hora de Tijuana en UTC ya es el dia
 * > siguiente, asi que derivar el dia de trabajo de un `timestamptz` partiria
 * > cada jornada en dos: el corte del dia y el contador diario de
 * > [[Folios|folios]] (que reinicia por vendedor y por dia, ADR-0001) darian
 * > numeros distintos segun la hora. Por eso el dia de trabajo **lo calcula la
 * > tablet con su reloj local** (`reloj.hoy()`, ver ADR-0004) y viaja aparte
 * > del instante; el servidor lo recibe, no lo re-deriva.
 * >
 * > Lo unico que el servidor hace con la zona horaria es esta comprobacion de
 * > cordura, para que un reloj de tablet mal puesto no meta operaciones en el
 * > futuro.
 */
export const ZONA_NEGOCIO = 'America/Tijuana';

export function hoyEnTijuana(ahora: Date = new Date()): string {
  // 'en-CA' formatea como AAAA-MM-DD, que es justo el formato que se compara.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONA_NEGOCIO,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(ahora);
}

/**
 * Margen hacia adelante que se tolera en `fecha_operacion`.
 *
 * Un dia, no cero: la tablet no tiene NTP garantizado en ruta, y ademas una
 * jornada que termina pasada la medianoche es un caso real. No hay margen hacia
 * atras a proposito — una tablet que estuvo dos semanas sin WiFi tiene que
 * poder subir esas dos semanas.
 */
const DIAS_TOLERANCIA_FUTURO = 1;

function sumarDias(fecha: string, dias: number): string {
  const [a, m, d] = fecha.split('-').map(Number);
  const base = Date.UTC(a, m - 1, d) + dias * 86_400_000;
  return new Date(base).toISOString().slice(0, 10);
}

function texto(valor: unknown): string | null {
  return typeof valor === 'string' && valor.trim() !== '' ? valor.trim() : null;
}

/**
 * Lo que el servidor sabe del vendedor por su cuenta, para poder comprobar que
 * el [[Folios|folio]] que trae la operacion no se contradice consigo mismo.
 *
 * Es un parametro **obligatorio** y no opcional a proposito: un valor por
 * defecto haria que un futuro llamador se saltara la comprobacion sin
 * enterarse, y esta es justamente la que impide que entren folios que despues
 * no se pueden cotejar contra la nota fisica.
 */
export interface ContextoVendedor {
  /** Codigo de 2 letras de su sucursal. Lo decide el servidor, no el cuerpo. */
  sucursal: string;
  /** Su 5o segmento del folio, o `null` si no tiene uno asignado. */
  segmentoFolio: string | null;
}

export function normalizarOperacion(
  cruda: unknown,
  vendedorIdDelToken: string,
  hoy: string,
  vendedor: ContextoVendedor,
): ResultadoNormalizacion {
  if (typeof cruda !== 'object' || cruda === null || Array.isArray(cruda)) {
    return {
      ok: false,
      codigo: 'datos-invalidos',
      motivo: 'La operacion debe ser un objeto.',
    };
  }

  const op = cruda as Record<string, unknown>;

  // El alcance se comprueba ANTES que nada: una operacion atribuida a otro
  // vendedor no es un dato malo que se pueda rechazar y seguir, es un cliente
  // intentando escribir fuera de lo suyo. Lo resuelve quien llama, con un 403
  // para todo el lote.
  const vendedorId = texto(op.vendedor_id);
  if (vendedorId !== null && vendedorId !== vendedorIdDelToken) {
    return { ok: 'ajena', vendedorId };
  }

  const clave = texto(op.clave);
  if (clave === null) {
    return {
      ok: false,
      codigo: 'clave-invalida',
      motivo: 'Falta la clave de idempotencia de la operacion.',
    };
  }
  if (clave.length > LARGO_MAX_CLAVE) {
    return {
      ok: false,
      codigo: 'clave-invalida',
      motivo: `La clave no puede pasar de ${LARGO_MAX_CLAVE} caracteres.`,
    };
  }

  const tipo = texto(op.tipo);
  if (tipo === null || !esTipoConocido(tipo)) {
    return {
      ok: false,
      codigo: 'tipo-desconocido',
      // Se nombra el tipo en el motivo a proposito: es el mensaje que un dia
      // le dira a un operador "esta tablet es mas nueva que este servidor".
      motivo: `Este servidor no conoce el tipo de operacion "${tipo ?? ''}".`,
    };
  }

  const fecha = texto(op.fecha_operacion);
  if (
    fecha === null ||
    !RE_FECHA.test(fecha) ||
    Number.isNaN(Date.parse(fecha))
  ) {
    return {
      ok: false,
      codigo: 'fecha-invalida',
      motivo: 'fecha_operacion debe ser una fecha AAAA-MM-DD.',
    };
  }
  if (fecha > sumarDias(hoy, DIAS_TOLERANCIA_FUTURO)) {
    return {
      ok: false,
      codigo: 'fecha-futura',
      motivo: `fecha_operacion (${fecha}) esta en el futuro respecto a hoy en ${ZONA_NEGOCIO} (${hoy}). Revisa el reloj de la tablet.`,
    };
  }

  const ocurrido = texto(op.ocurrido_en);
  if (ocurrido === null || Number.isNaN(Date.parse(ocurrido))) {
    return {
      ok: false,
      codigo: 'momento-invalido',
      motivo: 'ocurrido_en debe ser un instante ISO-8601.',
    };
  }

  const datos = op.datos;
  if (typeof datos !== 'object' || datos === null || Array.isArray(datos)) {
    return {
      ok: false,
      codigo: 'datos-invalidos',
      motivo: 'datos debe ser un objeto.',
    };
  }

  const clienteId = texto(op.cliente_id);
  if (clienteId !== null && !RE_UUID.test(clienteId)) {
    // Mismo codigo que "no existe": para el vendedor es lo mismo, y mantener el
    // enum cerrado evita cambiar el contrato por un caso de dato corrupto.
    return {
      ok: false,
      codigo: 'cliente-fuera-de-alcance',
      motivo: `"${clienteId}" no es un identificador de cliente valido.`,
    };
  }

  // El folio es OPCIONAL: hoy la `jornada` no lo lleva (no es una nota que
  // nadie firme) y venta/cobranza lo llevaran con T-16/T-20. Cuando viene, se
  // comprueba a fondo — un folio emitido no se corrige hacia atras.
  const folio = texto(op.folio);
  if (folio !== null) {
    const motivo = revisarFolio(folio, {
      sucursal: vendedor.sucursal,
      fechaOperacion: fecha,
      segmentoVendedor: vendedor.segmentoFolio,
    });
    if (motivo !== null) {
      return {
        ok: false,
        codigo: 'folio-invalido',
        motivo: explicarFolioInvalido(motivo),
      };
    }
  }

  return {
    ok: true,
    operacion: {
      clave,
      tipo,
      fechaOperacion: fecha,
      ocurridoEn: new Date(ocurrido).toISOString(),
      clienteId,
      folio,
      datos: datos as Record<string, unknown>,
    },
  };
}

/** El `tipo` que se pueda leer de una operacion cruda, para poder reportarla. */
export function tipoReportable(cruda: unknown): string {
  if (typeof cruda !== 'object' || cruda === null) return '';
  return texto((cruda as Record<string, unknown>).tipo) ?? '';
}

/** La `clave` que se pueda leer de una operacion cruda, para poder reportarla. */
export function claveReportable(cruda: unknown, posicion: number): string {
  if (typeof cruda !== 'object' || cruda === null) return `#${posicion}`;
  return texto((cruda as Record<string, unknown>).clave) ?? `#${posicion}`;
}
