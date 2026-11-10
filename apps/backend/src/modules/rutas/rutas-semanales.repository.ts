import { Inject, Injectable } from '@nestjs/common';
import { sql, type Transaction } from 'kysely';
import { DB_CONNECTION, type Database } from '../../database/database.tokens';
import type { DB } from '../../database/schema';
import { buscarSucursalUsuario as buscarSucursalUsuarioCompartido } from '../sucursales/buscar-sucursal-usuario';

/** Una ruta semanal viva con su sucursal (para el alcance). */
export interface FilaRutaSemanal {
  id: string;
  diaSemana: number;
  nombre: string;
  sucursalId: string;
  sucursalCodigo: string;
}

/** Un cliente de la ruta semanal, por orden, con lo que hace falta para decir si sigue valiendo. */
export interface ClienteDeRutaSemanalBruto {
  clienteId: string;
  nombre: string;
  valido: boolean;
}

/** Una ruta del dia (asignada a un vendedor) de una ruta semanal. */
export interface RutaDiaAsignada {
  vendedorId: string;
  vendedorNombre: string;
  /** `AAAA-MM-DD`. */
  fecha: string;
}

/**
 * SQL de la Ruta Semanal: la ruta, su lista de clientes y las lecturas de sus
 * `ruta_dia` que hace la propagacion. Toda escritura de la ruta de un dia
 * (`ruta`, `ruta_dia`, las `nota_asignada` que salen) es de
 * `RutasDiariasRepository`, salvo el `nombre_ruta` de `renombrarRutasDelDia`.
 */
@Injectable()
export class RutasSemanalesRepository {
  constructor(@Inject(DB_CONNECTION) private readonly db: Database) {}

  enTransaccion<T>(tarea: (trx: Transaction<DB>) => Promise<T>): Promise<T> {
    return this.db.transaction().execute(tarea);
  }

  buscarSucursalUsuario(
    usuarioId: string,
  ): Promise<{ id: string | null; codigo: string | null } | undefined> {
    return buscarSucursalUsuarioCompartido(this.db, usuarioId);
  }

  async sucursalPorCodigo(codigo: string): Promise<string | undefined> {
    const fila = await this.db
      .selectFrom('sucursal')
      .select('id')
      .where('codigo', '=', codigo)
      .executeTakeFirst();
    return fila?.id;
  }

  /** Las rutas vivas de una sucursal, con cuantos clientes vivos tiene su lista. */
  async listar(sucursalCodigo: string): Promise<
    (FilaRutaSemanal & {
      clientes: number;
    })[]
  > {
    const filas = await this.db
      .selectFrom('ruta_semanal as rs')
      .innerJoin('sucursal as s', 's.id', 'rs.sucursal_id')
      .select([
        'rs.id as id',
        'rs.dia_semana as diaSemana',
        'rs.nombre as nombre',
        'rs.sucursal_id as sucursalId',
        's.codigo as sucursalCodigo',
        (eb) =>
          eb
            .selectFrom('ruta_semanal_cliente as rsc')
            .select(sql<number>`count(*)::int`.as('n'))
            .whereRef('rsc.ruta_semanal_id', '=', 'rs.id')
            .where('rsc.deleted_at', 'is', null)
            .as('clientes'),
      ])
      .where('s.codigo', '=', sucursalCodigo)
      .where('rs.deleted_at', 'is', null)
      .orderBy('rs.dia_semana')
      .orderBy(sql`lower(rs.nombre)`)
      .execute();
    return filas.map((f) => ({ ...f, clientes: Number(f.clientes ?? 0) }));
  }

  /** La ruta viva, o `undefined`. Con `trx` la bloquea (`for no key update`). */
  async buscar(
    id: string,
    trx?: Transaction<DB>,
  ): Promise<FilaRutaSemanal | undefined> {
    let consulta = (trx ?? this.db)
      .selectFrom('ruta_semanal as rs')
      .innerJoin('sucursal as s', 's.id', 'rs.sucursal_id')
      .select([
        'rs.id as id',
        'rs.dia_semana as diaSemana',
        'rs.nombre as nombre',
        'rs.sucursal_id as sucursalId',
        's.codigo as sucursalCodigo',
      ])
      .where('rs.id', '=', id)
      .where('rs.deleted_at', 'is', null);
    // Solo la fila de la ruta: la de la sucursal no hace falta bloquearla.
    if (trx) consulta = consulta.forNoKeyUpdate('rs');
    return consulta.executeTakeFirst();
  }

  async crear(
    sucursalId: string,
    diaSemana: number,
    nombre: string,
  ): Promise<string> {
    const { id } = await this.db
      .insertInto('ruta_semanal')
      .values({ sucursal_id: sucursalId, dia_semana: diaSemana, nombre })
      .returning('id')
      .executeTakeFirstOrThrow();
    return id;
  }

  async renombrar(
    id: string,
    nombre: string,
    trx: Transaction<DB>,
  ): Promise<void> {
    await trx
      .updateTable('ruta_semanal')
      .set({ nombre })
      .where('id', '=', id)
      .execute();
  }

  /** Copia el nombre nuevo a sus rutas del dia de `desde` en adelante; las pasadas conservan el suyo. */
  async renombrarRutasDelDia(
    rutaSemanalId: string,
    nombre: string,
    desde: string,
    trx: Transaction<DB>,
  ): Promise<void> {
    await trx
      .updateTable('ruta_dia')
      .set({ nombre_ruta: nombre })
      .where('ruta_semanal_id', '=', rutaSemanalId)
      .where('deleted_at', 'is', null)
      .where(sql<boolean>`fecha >= ${desde}::date`)
      .execute();
  }

  async darDeBaja(id: string, trx: Transaction<DB>): Promise<void> {
    await trx
      .updateTable('ruta_semanal')
      .set({ deleted_at: new Date() })
      .where('id', '=', id)
      .execute();
  }

  /**
   * La lista de la ruta, por orden. `valido` = cliente vivo, `tipo = 'cliente'`
   * y de la sucursal de la ruta: lo que la propagacion copiaria hoy.
   */
  async lista(
    ruta: FilaRutaSemanal,
    trx?: Transaction<DB>,
  ): Promise<ClienteDeRutaSemanalBruto[]> {
    const filas = await (trx ?? this.db)
      .selectFrom('ruta_semanal_cliente as rsc')
      .innerJoin('cliente as c', 'c.id', 'rsc.cliente_id')
      .select([
        'rsc.cliente_id as clienteId',
        'c.nombre as nombre',
        sql<boolean>`(c.deleted_at is null and c.tipo = 'cliente' and c.sucursal_id = ${ruta.sucursalId})`.as(
          'valido',
        ),
      ])
      .where('rsc.ruta_semanal_id', '=', ruta.id)
      .where('rsc.deleted_at', 'is', null)
      .orderBy('rsc.orden')
      .execute();
    return filas;
  }

  /** Las filas vivas de la lista: id de la fila y cliente. */
  async filasDeLista(
    rutaSemanalId: string,
    trx: Transaction<DB>,
  ): Promise<{ id: string; clienteId: string }[]> {
    return trx
      .selectFrom('ruta_semanal_cliente')
      .select(['id', 'cliente_id as clienteId'])
      .where('ruta_semanal_id', '=', rutaSemanalId)
      .where('deleted_at', 'is', null)
      .execute();
  }

  /**
   * Reemplaza la lista: baja de las filas que salen, orden = posicion para las
   * que se quedan y alta de las nuevas. La ruta ya esta bloqueada.
   */
  async reemplazarLista(
    rutaSemanalId: string,
    actuales: readonly { id: string; clienteId: string }[],
    clientes: readonly string[],
    trx: Transaction<DB>,
  ): Promise<void> {
    const posicion = new Map(clientes.map((c, i) => [c, i + 1]));
    const salen = actuales.filter((f) => !posicion.has(f.clienteId));
    if (salen.length > 0) {
      await trx
        .updateTable('ruta_semanal_cliente')
        .set({ deleted_at: new Date() })
        .where(
          'id',
          'in',
          salen.map((f) => f.id),
        )
        .execute();
    }
    const yaEstan = new Set<string>();
    for (const fila of actuales) {
      const orden = posicion.get(fila.clienteId);
      if (orden === undefined) continue;
      yaEstan.add(fila.clienteId);
      await trx
        .updateTable('ruta_semanal_cliente')
        .set({ orden })
        .where('id', '=', fila.id)
        .execute();
    }
    const nuevos = clientes.filter((c) => !yaEstan.has(c));
    if (nuevos.length > 0) {
      await trx
        .insertInto('ruta_semanal_cliente')
        .values(
          nuevos.map((clienteId) => ({
            ruta_semanal_id: rutaSemanalId,
            cliente_id: clienteId,
            orden: posicion.get(clienteId)!,
          })),
        )
        .execute();
    }
  }

  /**
   * Las rutas del dia vivas de esa ruta semanal con fecha `>= desde`, ordenadas
   * por vendedor (el orden en que se bloquean, para no abrazarse con otra
   * transaccion) y fecha.
   */
  async asignadasDesde(
    rutaSemanalId: string,
    desde: string,
    trx?: Transaction<DB>,
  ): Promise<RutaDiaAsignada[]> {
    return (trx ?? this.db)
      .selectFrom('ruta_dia as rd')
      .innerJoin('vendedor as v', 'v.id', 'rd.vendedor_id')
      .select([
        'rd.vendedor_id as vendedorId',
        'v.nombre as vendedorNombre',
        sql<string>`to_char(rd.fecha, 'YYYY-MM-DD')`.as('fecha'),
      ])
      .where('rd.ruta_semanal_id', '=', rutaSemanalId)
      .where('rd.deleted_at', 'is', null)
      .where(sql<boolean>`rd.fecha >= ${desde}::date`)
      .orderBy('rd.vendedor_id')
      .orderBy('rd.fecha')
      .execute();
  }

  /**
   * Clientes que la oficina quito A MANO de la ruta de ese vendedor y dia
   * (`quitado_por = 'oficina'`): un cambio de la semanal no los vuelve a poner.
   */
  async quitadosAMano(
    vendedorId: string,
    fecha: string,
    trx: Transaction<DB>,
  ): Promise<Set<string>> {
    const filas = await trx
      .selectFrom('ruta')
      .select('cliente_id')
      .distinct()
      .where('vendedor_id', '=', vendedorId)
      .where(sql<boolean>`fecha = ${fecha}::date`)
      .where('tipo', '=', 'diaria')
      .where('deleted_at', 'is not', null)
      .where('quitado_por', '=', 'oficina')
      .execute();
    return new Set(filas.map((f) => f.cliente_id));
  }
}
