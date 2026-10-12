import { Inject, Injectable } from '@nestjs/common';
import { sql, type Transaction } from 'kysely';
import { DB_CONNECTION, type Database } from '../../database/database.tokens';
import type { DB } from '../../database/schema';
import { buscarSucursalUsuario as buscarSucursalUsuarioCompartido } from '../sucursales/buscar-sucursal-usuario';
import type { FilaViva, PlanReemplazo } from './reemplazo-ruta';

export type OrigenRuta = 'oficina' | 'vendedor';

/** Una fila de `ruta` diaria lista para escribir. */
export interface NuevaFilaRuta {
  vendedorId: string;
  clienteId: string;
  /** `AAAA-MM-DD`. En un alta de la tablet, la `fecha_operacion` tal cual. */
  fecha: string;
  orden: number;
  origen: OrigenRuta;
}

/** El vendedor de una ruta, con su sucursal (para el alcance y la cartera). */
export interface VendedorDeRuta {
  id: string;
  nombre: string;
  sucursalId: string;
  sucursalCodigo: string;
}

/** Una fila de la ruta como la pinta el portal. */
export interface FilaRutaDiaria {
  id: string;
  clienteId: string;
  clienteNombre: string;
  orden: number;
  origen: OrigenRuta;
}

/**
 * SQL de la ruta diaria (T-37).
 *
 * Los metodos del push reciben la `trx` de la operacion y ninguno abre la suya:
 * el alta entra o sale junto con su fila del buzon (ADR-0009 §2.3). Los del
 * portal (Tarea 5) usan `enTransaccion`.
 */
@Injectable()
export class RutasDiariasRepository {
  constructor(@Inject(DB_CONNECTION) private readonly db: Database) {}

  /**
   * ¿El cliente existe, no esta dado de baja, es de esa sucursal y es
   * `tipo = 'cliente'`? A un prospecto no se le vende (D7), asi que no entra a
   * la ruta.
   */
  async clienteParaRuta(
    clienteId: string,
    sucursalId: string,
    trx: Transaction<DB>,
  ): Promise<boolean> {
    const fila = await trx
      .selectFrom('cliente')
      .select('id')
      .where('id', '=', clienteId)
      .where('sucursal_id', '=', sucursalId)
      .where('tipo', '=', 'cliente')
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    return fila !== undefined;
  }

  /**
   * Bloquea la fila del vendedor hasta el fin de la transaccion.
   *
   * Es el candado comun del alta (push) y del reemplazo (portal) de la ruta de
   * ese vendedor: sin el, dos transacciones calculan el mismo orden siguiente, o
   * el portal lee las vivas antes de que un alta haga commit y revienta con
   * `23505`. `for no key update` y no `for update`: no bloquea los inserts de
   * otras tablas que solo referencian al vendedor (ventas, jornada).
   */
  async bloquearVendedor(
    vendedorId: string,
    trx: Transaction<DB>,
  ): Promise<void> {
    await trx
      .selectFrom('vendedor')
      .select('id')
      .where('id', '=', vendedorId)
      .forNoKeyUpdate()
      .execute();
  }

  /** `max(orden) + 1` entre las vivas de ese vendedor y dia, o `1` si no hay. */
  async siguienteOrden(
    vendedorId: string,
    fecha: string,
    trx: Transaction<DB>,
  ): Promise<number> {
    const fila = await trx
      .selectFrom('ruta')
      .select(sql<number>`coalesce(max(orden), 0) + 1`.as('siguiente'))
      .where('vendedor_id', '=', vendedorId)
      .where(sql<boolean>`fecha = ${fecha}::date`)
      .where('tipo', '=', 'diaria')
      .where('deleted_at', 'is', null)
      .executeTakeFirstOrThrow();
    return Number(fila.siguiente);
  }

  /**
   * Inserta la fila, o devuelve `null` si ese vendedor ya tenia a ese cliente
   * vivo en la ruta diaria de ese dia (`uq_ruta_diaria_vendedor_fecha_cliente`).
   *
   * `on conflict ... do nothing` y no atrapar el `23505`: un `unique_violation`
   * aborta la transaccion entera de Postgres (T-16, D10). El predicado del
   * indice parcial va entero para que Postgres lo pueda usar como arbitro, y el
   * `tipo = 'diaria'` va LITERAL (no como parametro `$n`): la inferencia del
   * indice compara contra constantes.
   */
  async insertarSiNoExiste(
    nueva: NuevaFilaRuta,
    trx: Transaction<DB>,
  ): Promise<string | null> {
    const fila = await trx
      .insertInto('ruta')
      .values({
        vendedor_id: nueva.vendedorId,
        cliente_id: nueva.clienteId,
        fecha: nueva.fecha,
        orden: nueva.orden,
        origen: nueva.origen,
        tipo: 'diaria',
      })
      .onConflict((oc) =>
        oc
          .columns(['vendedor_id', 'fecha', 'cliente_id'])
          .where('deleted_at', 'is', null)
          .where(sql<boolean>`tipo = 'diaria'`)
          .doNothing(),
      )
      .returning('id')
      .executeTakeFirst();
    return fila?.id ?? null;
  }

  /** Abre la transaccion del reemplazo del portal. */
  async enTransaccion<T>(
    tarea: (trx: Transaction<DB>) => Promise<T>,
  ): Promise<T> {
    return this.db.transaction().execute(tarea);
  }

  buscarSucursalUsuario(
    usuarioId: string,
  ): Promise<{ id: string | null; codigo: string | null } | undefined> {
    return buscarSucursalUsuarioCompartido(this.db, usuarioId);
  }

  /** El vendedor vivo (sin `deleted_at`), activo o no. */
  async vendedorDeRuta(
    vendedorId: string,
  ): Promise<VendedorDeRuta | undefined> {
    return this.db
      .selectFrom('vendedor')
      .innerJoin('sucursal', 'sucursal.id', 'vendedor.sucursal_id')
      .select([
        'vendedor.id as id',
        'vendedor.nombre as nombre',
        'vendedor.sucursal_id as sucursalId',
        'sucursal.codigo as sucursalCodigo',
      ])
      .where('vendedor.id', '=', vendedorId)
      .where('vendedor.deleted_at', 'is', null)
      .executeTakeFirst();
  }

  /** Las filas vivas de la ruta diaria de un vendedor y dia, por orden, con el nombre del cliente. */
  async filasDelDia(
    vendedorId: string,
    fecha: string,
  ): Promise<FilaRutaDiaria[]> {
    const filas = await this.db
      .selectFrom('ruta')
      .innerJoin('cliente', 'cliente.id', 'ruta.cliente_id')
      .select([
        'ruta.id as id',
        'ruta.cliente_id as clienteId',
        'cliente.nombre as clienteNombre',
        'ruta.orden as orden',
        'ruta.origen as origen',
      ])
      .where('ruta.vendedor_id', '=', vendedorId)
      .where(sql<boolean>`ruta.fecha = ${fecha}::date`)
      .where('ruta.tipo', '=', 'diaria')
      .where('ruta.deleted_at', 'is', null)
      .orderBy('ruta.orden')
      .orderBy('ruta.created_at')
      .execute();
    return filas.map((f) => ({ ...f, origen: f.origen as OrigenRuta }));
  }

  /** Lo mismo, dentro de la transaccion y sin nombre: lo que lee el reemplazo. */
  async filasVivas(
    vendedorId: string,
    fecha: string,
    trx: Transaction<DB>,
  ): Promise<FilaViva[]> {
    const filas = await trx
      .selectFrom('ruta')
      .select(['id', 'cliente_id', 'orden', 'origen'])
      .where('vendedor_id', '=', vendedorId)
      .where(sql<boolean>`fecha = ${fecha}::date`)
      .where('tipo', '=', 'diaria')
      .where('deleted_at', 'is', null)
      .orderBy('orden')
      .execute();
    return filas.map((f) => ({
      id: f.id,
      clienteId: f.cliente_id,
      orden: f.orden,
      origen: f.origen as OrigenRuta,
    }));
  }

  /** De una lista de ids, cuales son clientes vivos, `tipo = 'cliente'`, de esa sucursal. */
  async clientesParaRuta(
    ids: readonly string[],
    sucursalId: string,
    trx: Transaction<DB>,
  ): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const filas = await trx
      .selectFrom('cliente')
      .select('id')
      .where('id', 'in', [...ids])
      .where('sucursal_id', '=', sucursalId)
      .where('tipo', '=', 'cliente')
      .where('deleted_at', 'is', null)
      .execute();
    return new Set(filas.map((f) => f.id));
  }

  /**
   * Nombre de cada id que sea un cliente de ESA sucursal (la del vendedor, que
   * el usuario ya alcanza), borrado o prospecto incluidos: para nombrar en el
   * 400 a los clientes que no valen. Un id de otra sucursal o que ni existe no
   * viene en el mapa: nombrarlo filtraria datos de una sucursal que el usuario
   * no alcanza.
   */
  async nombresDeClientes(
    ids: readonly string[],
    sucursalId: string,
    trx: Transaction<DB>,
  ): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const filas = await trx
      .selectFrom('cliente')
      .select(['id', 'nombre'])
      .where('id', 'in', [...ids])
      .where('sucursal_id', '=', sucursalId)
      .execute();
    return new Map(filas.map((f) => [f.id, f.nombre]));
  }

  /**
   * Escribe el plan del reemplazo. La fila del vendedor ya esta bloqueada y las
   * vivas se leyeron despues del candado, asi que los inserts no pueden chocar
   * con la unicidad.
   */
  async aplicarReemplazo(
    vendedorId: string,
    fecha: string,
    plan: PlanReemplazo,
    trx: Transaction<DB>,
  ): Promise<void> {
    if (plan.borrar.length > 0) {
      await trx
        .updateTable('ruta')
        .set({ deleted_at: new Date() })
        .where('id', 'in', plan.borrar)
        .execute();
    }
    for (const fila of plan.actualizar) {
      await trx
        .updateTable('ruta')
        .set({ orden: fila.orden, origen: fila.origen })
        .where('id', '=', fila.id)
        .execute();
    }
    if (plan.insertar.length > 0) {
      await trx
        .insertInto('ruta')
        .values(
          plan.insertar.map((fila) => ({
            vendedor_id: vendedorId,
            cliente_id: fila.clienteId,
            fecha,
            orden: fila.orden,
            origen: 'oficina',
            tipo: 'diaria',
          })),
        )
        .execute();
    }
  }

  /** La ultima fecha ANTERIOR a `fecha` con filas vivas de ese vendedor, o `null`. */
  async fechaAnteriorConRuta(
    vendedorId: string,
    fecha: string,
  ): Promise<string | null> {
    const fila = await this.db
      .selectFrom('ruta')
      .select(sql<string | null>`to_char(max(fecha), 'YYYY-MM-DD')`.as('fecha'))
      .where('vendedor_id', '=', vendedorId)
      .where('tipo', '=', 'diaria')
      .where('deleted_at', 'is', null)
      .where(sql<boolean>`fecha < ${fecha}::date`)
      .executeTakeFirst();
    return fila?.fecha ?? null;
  }

  /**
   * Los clientes de la ruta viva de ese dia, por orden, **solo** los que hoy
   * siguen siendo validos para una ruta (vivos, `tipo = 'cliente'`, de la
   * sucursal): lo que el `PUT` aceptaria.
   */
  async clientesValidosDeFecha(
    vendedorId: string,
    fecha: string,
    sucursalId: string,
  ): Promise<string[]> {
    const filas = await this.db
      .selectFrom('ruta')
      .innerJoin('cliente', 'cliente.id', 'ruta.cliente_id')
      .select('ruta.cliente_id as clienteId')
      .where('ruta.vendedor_id', '=', vendedorId)
      .where(sql<boolean>`ruta.fecha = ${fecha}::date`)
      .where('ruta.tipo', '=', 'diaria')
      .where('ruta.deleted_at', 'is', null)
      .where('cliente.deleted_at', 'is', null)
      .where('cliente.tipo', '=', 'cliente')
      .where('cliente.sucursal_id', '=', sucursalId)
      .orderBy('ruta.orden')
      .execute();
    return filas.map((f) => f.clienteId);
  }
}
