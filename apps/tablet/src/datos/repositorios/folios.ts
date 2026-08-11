import type { BaseDatos } from '../base-datos';
import type { DepsRepositorio } from './deps';
import type { FechaISO } from '../tipos';

/**
 * Emision **offline** de [[Folios|folios]] de operacion (T-14).
 *
 * El formato lo manda [[ADR-0001 Formato de folios]]: 12 caracteres en 6
 * segmentos de 2.
 *
 * ```
 *   TJ 26 03 22 AP 05
 *   sucursal | ano | mes | dia | vendedor | operacion del dia
 * ```
 *
 * ## El bug que este repositorio corrige
 *
 * En el sistema v1 "el vendedor empieza en la operacion que finalizo el dia
 * anterior": el contador **no reinicia**. Aqui no puede pasar, y no por una
 * comprobacion que haya que acordarse de escribir, sino por la **forma de la
 * tabla**: el consecutivo cuelga de la llave `(vendedor, sucursal, fecha)`. Un
 * dia nuevo es una fila nueva, y una fila nueva arranca en 1. No hay ningun
 * sitio donde se lea "el ultimo folio emitido".
 *
 * ## Emitir es atomico y reentrante
 *
 * - **Atomico**: todo ocurre dentro de un `savepoint`, asi que o se incrementa
 *   el contador y se registra el folio, o no pasa ninguna de las dos cosas.
 * - **Reentrante**: pedir folio dos veces para la **misma operacion** devuelve
 *   el mismo folio en vez de quemar un numero nuevo. Es lo que evita saltos
 *   cuando la app se cierra a media operacion y al volver reintenta.
 *
 * > [!danger] Emite DENTRO de la transaccion que guarda la operacion
 * > Se usa `savepoint` y no `begin` justamente para que esto se pueda componer:
 * > `emitir()` funciona suelto y tambien anidado dentro de un `enTransaccion()`
 * > de quien llama.
 * >
 * > **T-16/T-20 tienen que llamarlo dentro de su propia transaccion.** Si se
 * > emite por separado y la app muere antes de escribir la operacion, ese
 * > numero queda quemado: al reintentar, la captura sera una fila local nueva
 * > con otra clave, y pedira otro folio. La reentrancia por clave cubre el
 * > reintento de la *misma* fila; la transaccion compartida cubre el hueco
 * > entre emitir y guardar.
 *
 * > [!warning] El reloj de la tablet es manipulable
 * > Se **garantiza** que un dispositivo nunca emite dos veces el mismo folio:
 * > mover la fecha hacia atras encuentra la fila de ese dia ya creada y
 * > **continua** el contador en vez de reiniciarlo. **No** se garantiza que la
 * > fecha del folio sea la real. Ver ADR-0005 y ADR-0006: es la misma
 * > superficie que el proyecto ya acepta por operar sin red.
 */

/** Error de regla de folios (no un fallo tecnico de SQLite). */
export class ErrorFolio extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'ErrorFolio';
  }
}

/**
 * Tope de operaciones por vendedor y dia.
 *
 * El consecutivo son **2 digitos**, asi que no caben mas. ADR-0001 lo registra
 * como consecuencia aceptada ("suficiente hoy; vigilar a futuro"). Se falla en
 * vez de dar la vuelta a 00 o de crecer a 3 digitos: las dos cosas romperian el
 * formato que el cliente confirmo, y el folio ya estaria escrito en papel.
 */
export const MAX_OPERACIONES_POR_DIA = 99;

export interface FolioEmitido {
  folio: string;
  vendedor_id: string;
  sucursal_id: string;
  fecha: FechaISO;
  consecutivo: number;
  operacion_clave: string;
  emitido_en: string;
}

export interface PeticionFolio {
  vendedorId: string;
  /**
   * La operacion que va a llevar este folio: el `id` de su fila local, que es
   * tambien su clave de idempotencia en el push.
   *
   * Es lo que hace la emision reentrante. **No** convierte al folio en clave de
   * idempotencia ni al reves: siguen siendo capas distintas (T-07/ADR-0006).
   */
  claveOperacion: string;
}

export type RepositorioFolios = ReturnType<typeof crearRepositorioFolios>;

/**
 * Ejecuta `tarea` dentro de un `savepoint`.
 *
 * A diferencia de `enTransaccion()`, esto **se puede anidar**: si ya hay una
 * transaccion abierta se cuelga de ella, y si no la hay SQLite trata el
 * savepoint mas externo como una transaccion. Es lo que permite que T-16 emita
 * el folio dentro de la misma transaccion en la que guarda la venta.
 */
function enSavepoint<T>(bd: BaseDatos, nombre: string, tarea: () => T): T {
  bd.execSync(`savepoint ${nombre};`);
  try {
    const resultado = tarea();
    bd.execSync(`release ${nombre};`);
    return resultado;
  } catch (error) {
    bd.execSync(`rollback to ${nombre};`);
    bd.execSync(`release ${nombre};`);
    throw error;
  }
}

interface FilaVendedor {
  sucursal_id: string;
  folio_segmento: string | null;
  sucursal_codigo: string;
}

export function crearRepositorioFolios({ bd, reloj }: DepsRepositorio) {
  const repo = {
    /**
     * Emite el folio de una operacion, o devuelve el que ya tenia.
     *
     * @throws {ErrorFolio} si el vendedor no existe, si no tiene segmento de
     * folio asignado (nunca ha sincronizado), o si ya llego a las 99
     * operaciones del dia.
     */
    emitir({ vendedorId, claveOperacion }: PeticionFolio): FolioEmitido {
      return enSavepoint(bd, 'folio', () => {
        // 1. ¿Esta operacion ya tenia folio? Reentrancia: se devuelve el mismo
        //    y NO se quema un numero. Es lo que evita huecos en la numeracion
        //    cuando la app se cierra a media captura y al volver reintenta.
        const yaEmitido = repo.porOperacion(claveOperacion);
        if (yaEmitido) return yaEmitido;

        const vendedor = bd.getFirstSync<FilaVendedor>(
          `select v.sucursal_id, v.folio_segmento, s.codigo as sucursal_codigo
             from vendedor v
             join sucursal s on s.id = v.sucursal_id
            where v.id = $id`,
          { $id: vendedorId },
        );

        if (!vendedor) {
          throw new ErrorFolio(`No existe el vendedor ${vendedorId}.`);
        }

        // El segmento lo asigna el SERVIDOR y baja en el pull. La tablet no lo
        // deriva de `nombre` aunque pudiera: no ve a sus companeros, asi que no
        // podria saber si sus iniciales chocan con las de otro. Inventarlo aqui
        // reintroduciria en silencio la ambiguedad que sigue pendiente de
        // confirmar con el cliente.
        if (!vendedor.folio_segmento) {
          throw new ErrorFolio(
            'Este vendedor todavia no tiene segmento de folio. Sincroniza con el servidor antes de operar.',
          );
        }

        const fecha = reloj.hoy();
        const ahora = reloj.ahora();

        // 2. El contador del DIA. `on conflict do update` incrementa en una
        //    sola sentencia: no hay hueco entre leer y escribir en el que
        //    quepa otra emision.
        bd.runSync(
          `insert into folio_contador
             (vendedor_id, sucursal_id, fecha, ultimo, creado_en, actualizado_en)
           values ($vendedor_id, $sucursal_id, $fecha, 1, $ahora, $ahora)
           on conflict (vendedor_id, sucursal_id, fecha) do update set
             ultimo = folio_contador.ultimo + 1,
             actualizado_en = excluded.actualizado_en`,
          {
            $vendedor_id: vendedorId,
            $sucursal_id: vendedor.sucursal_id,
            $fecha: fecha,
            $ahora: ahora,
          },
        );

        const contador = bd.getFirstSync<{ ultimo: number }>(
          `select ultimo from folio_contador
            where vendedor_id = $vendedor_id
              and sucursal_id = $sucursal_id
              and fecha = $fecha`,
          {
            $vendedor_id: vendedorId,
            $sucursal_id: vendedor.sucursal_id,
            $fecha: fecha,
          },
        );

        if (!contador) {
          throw new ErrorFolio('No se pudo leer el contador de folios.');
        }

        if (contador.ultimo > MAX_OPERACIONES_POR_DIA) {
          // El savepoint revierte el incremento, asi que el contador no se
          // queda por encima del tope tras un intento fallido.
          throw new ErrorFolio(
            `Este vendedor ya llego a ${MAX_OPERACIONES_POR_DIA} operaciones el ${fecha}. El folio solo tiene 2 digitos para el consecutivo (ADR-0001).`,
          );
        }

        const folio = formarFolio(
          vendedor.sucursal_codigo,
          fecha,
          vendedor.folio_segmento,
          contador.ultimo,
        );

        // 3. Se registra. `folio` es llave primaria: si por lo que sea ese
        //    folio ya existiera, la base lo impide aqui y el savepoint revierte
        //    el incremento del contador.
        bd.runSync(
          `insert into folio_emitido
             (folio, vendedor_id, sucursal_id, fecha, consecutivo,
              operacion_clave, emitido_en)
           values ($folio, $vendedor_id, $sucursal_id, $fecha, $consecutivo,
                   $operacion_clave, $emitido_en)`,
          {
            $folio: folio,
            $vendedor_id: vendedorId,
            $sucursal_id: vendedor.sucursal_id,
            $fecha: fecha,
            $consecutivo: contador.ultimo,
            $operacion_clave: claveOperacion,
            $emitido_en: ahora,
          },
        );

        const emitido = repo.porOperacion(claveOperacion);
        if (!emitido) {
          throw new ErrorFolio('No se pudo leer el folio recien emitido.');
        }
        return emitido;
      });
    },

    /** El folio que se le dio a esa operacion, si ya se emitio. */
    porOperacion(claveOperacion: string): FolioEmitido | null {
      return bd.getFirstSync<FolioEmitido>(
        'select * from folio_emitido where operacion_clave = $clave',
        { $clave: claveOperacion },
      );
    },

    porFolio(folio: string): FolioEmitido | null {
      return bd.getFirstSync<FolioEmitido>(
        'select * from folio_emitido where folio = $folio',
        { $folio: folio },
      );
    },

    /**
     * Cuantas operaciones lleva foliadas ese vendedor ese dia.
     *
     * Se lee del contador y no de `count(*)` sobre `folio_emitido`: el contador
     * es la fuente de la numeracion, y cuadrarlos es justamente lo que las
     * pruebas comprueban.
     */
    consecutivoDe(vendedorId: string, fecha: FechaISO = reloj.hoy()): number {
      const fila = bd.getFirstSync<{ ultimo: number }>(
        `select ultimo from folio_contador
          where vendedor_id = $vendedor_id and fecha = $fecha`,
        { $vendedor_id: vendedorId, $fecha: fecha },
      );
      return fila?.ultimo ?? 0;
    },

    /** Los folios emitidos ese dia, en orden. Para el corte del dia (T-38). */
    delDia(vendedorId: string, fecha: FechaISO = reloj.hoy()): FolioEmitido[] {
      return bd.getAllSync<FolioEmitido>(
        `select * from folio_emitido
          where vendedor_id = $vendedor_id and fecha = $fecha
          order by consecutivo`,
        { $vendedor_id: vendedorId, $fecha: fecha },
      );
    },
  };

  return repo;
}

/**
 * Arma el folio a partir de sus 6 segmentos (ADR-0001).
 *
 * Se exporta para poder probar el formato solo, sin base de datos. La copia
 * normativa del lado del servidor vive en
 * `apps/backend/src/modules/sincronizacion/folio.ts` — misma duplicacion
 * deliberada que el contrato de sincronizacion, y por el mismo motivo: la
 * tablet no puede importar del backend (Metro).
 */
export function formarFolio(
  sucursal: string,
  fecha: FechaISO,
  segmentoVendedor: string,
  consecutivo: number,
): string {
  const [anio = '', mes = '', dia = ''] = fecha.split('-');
  return (
    sucursal.toUpperCase() +
    anio.slice(2) +
    mes +
    dia +
    segmentoVendedor.toUpperCase() +
    `${consecutivo}`.padStart(2, '0')
  );
}
