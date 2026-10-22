import { Inject, Injectable } from '@nestjs/common';
import { sql, type Kysely, type Transaction } from 'kysely';
import { DB_CONNECTION, type Database } from '../../database/database.tokens';
import type { DB } from '../../database/schema';
import { buscarSucursalUsuario } from '../sucursales/buscar-sucursal-usuario';
import type { FilaViva, LineaPedida } from './reglas-produccion';

/** El vendedor (vivo, activo o no) con su sucursal: el alcance y la `sucursal_id` del retorno. */
export interface VendedorRetorno {
  id: string;
  nombre: string;
  sucursalId: string;
  sucursalCodigo: string;
}

/** Una presentacion del dia con lo retornado y lo cargado (0 si no hay). */
export interface LineaRetorno {
  presentacionId: string;
  producto: string;
  presentacion: string;
  activa: boolean;
  piezas: number;
  /** Piezas de las cargas **aceptadas** y vivas del vendedor ese dia (referencia). */
  cargadas: number;
}

/** Que dia de que vendedor. */
export interface DiaVendedor {
  vendedorId: string;
  /** `AAAA-MM-DD`. */
  fecha: string;
}

/** Activa = presentacion y producto vivos y el producto activo (como en las cargas). */
const ACTIVA = sql<boolean>`(pr.deleted_at is null and p.deleted_at is null and p.activo)`;

/**
 * SQL del retorno del vendedor. Los metodos que escriben reciben la `trx` del
 * servicio; ninguno abre la suya. Las cargas solo se leen.
 */
@Injectable()
export class RetornosRepository {
  constructor(@Inject(DB_CONNECTION) private readonly db: Database) {}

  enTransaccion<T>(tarea: (trx: Transaction<DB>) => Promise<T>): Promise<T> {
    return this.db.transaction().execute(tarea);
  }

  buscarSucursalUsuario(
    usuarioId: string,
  ): Promise<{ id: string | null; codigo: string | null } | undefined> {
    return buscarSucursalUsuario(this.db, usuarioId);
  }

  /** Hoy en Tijuana, del reloj de Postgres (nunca UTC): el tope de la fecha. */
  async hoyEnTijuana(): Promise<string> {
    const r = await sql<{ hoy: string }>`
      select to_char((now() at time zone 'America/Tijuana')::date, 'YYYY-MM-DD') as hoy
    `.execute(this.db);
    return r.rows[0].hoy;
  }

  async vendedor(
    id: string,
    db: Kysely<DB> = this.db,
  ): Promise<VendedorRetorno | undefined> {
    return db
      .selectFrom('vendedor')
      .innerJoin('sucursal', 'sucursal.id', 'vendedor.sucursal_id')
      .select([
        'vendedor.id as id',
        'vendedor.nombre as nombre',
        'vendedor.sucursal_id as sucursalId',
        'sucursal.codigo as sucursalCodigo',
      ])
      .where('vendedor.id', '=', id)
      .where('vendedor.deleted_at', 'is', null)
      .executeTakeFirst();
  }

  /**
   * Bloquea la fila del vendedor hasta el fin de la transaccion: dos guardados
   * del mismo vendedor y dia se aplican uno despues del otro, tambien el primero
   * (cuando aun no hay filas de `retorno` que bloquear). Mismo patron que las
   * cargas (`for no key update` no frena los inserts que solo lo referencian).
   * El candado va sobre `vendedor` sola: con un join bloquearia la sucursal.
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

  /** Las filas vivas del dia, bloqueadas (`for update`), ya con el vendedor bloqueado. */
  async bloquearVivas(
    dia: DiaVendedor,
    trx: Transaction<DB>,
  ): Promise<FilaViva[]> {
    return trx
      .selectFrom('retorno')
      .select(['id', 'presentacion_id as presentacionId', 'piezas'])
      .where('vendedor_id', '=', dia.vendedorId)
      .where(sql<boolean>`fecha = ${dia.fecha}::date`)
      .where('deleted_at', 'is', null)
      .forUpdate()
      .execute();
  }

  /**
   * De esos ids, los que se pueden capturar: presentaciones vivas de un producto
   * vivo (activo o no) o que el vendedor traia en una carga aceptada ese dia
   * (lo que se cargo puede regresar aunque ya no este en el catalogo).
   */
  async idsCapturables(
    dia: DiaVendedor,
    ids: readonly string[],
    trx: Transaction<DB>,
  ): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const filas = await trx
      .selectFrom('presentacion as pr')
      .innerJoin('producto as p', 'p.id', 'pr.producto_id')
      .select('pr.id as id')
      .where('pr.id', 'in', [...ids])
      .where((eb) =>
        eb.or([
          eb.and([
            eb('pr.deleted_at', 'is', null),
            eb('p.deleted_at', 'is', null),
          ]),
          eb(
            'pr.id',
            'in',
            this.cargasAceptadasDelDia(dia, trx).select('cd.presentacion_id'),
          ),
        ]),
      )
      .execute();
    return new Set(filas.map((f) => f.id));
  }

  async insertar(
    dia: DiaVendedor,
    sucursalId: string,
    lineas: readonly LineaPedida[],
    usuarioId: string,
    trx: Transaction<DB>,
  ): Promise<void> {
    if (lineas.length === 0) return;
    await trx
      .insertInto('retorno')
      .values(
        lineas.map((l) => ({
          fecha: sql<Date>`${dia.fecha}::date`,
          vendedor_id: dia.vendedorId,
          sucursal_id: sucursalId,
          presentacion_id: l.presentacionId,
          piezas: l.piezas,
          capturo_usuario_id: usuarioId,
        })),
      )
      .execute();
  }

  async actualizar(
    cambios: readonly { id: string; piezas: number }[],
    usuarioId: string,
    trx: Transaction<DB>,
  ): Promise<void> {
    for (const c of cambios) {
      await trx
        .updateTable('retorno')
        .set({ piezas: c.piezas, actualizado_por_usuario_id: usuarioId })
        .where('id', '=', c.id)
        .execute();
    }
  }

  /** Baja logica: libera el lugar en el indice unico para volver a capturar. */
  async darDeBaja(
    ids: readonly string[],
    usuarioId: string,
    trx: Transaction<DB>,
  ): Promise<void> {
    if (ids.length === 0) return;
    await trx
      .updateTable('retorno')
      .set({ deleted_at: sql`now()`, actualizado_por_usuario_id: usuarioId })
      .where('id', 'in', [...ids])
      .execute();
  }

  /**
   * Las lineas de las cargas **aceptadas** y vivas del vendedor ese dia
   * (pendientes, rechazadas y dadas de baja no cuentan). `carga_detalle` no
   * tiene baja logica: editar una carga reemplaza sus lineas.
   */
  private cargasAceptadasDelDia(dia: DiaVendedor, db: Kysely<DB>) {
    return db
      .selectFrom('carga as c')
      .innerJoin('carga_detalle as cd', 'cd.carga_id', 'c.id')
      .where('c.vendedor_id', '=', dia.vendedorId)
      .where(sql<boolean>`c.fecha = ${dia.fecha}::date`)
      .where('c.estado', '=', 'aceptada')
      .where('c.deleted_at', 'is', null);
  }

  /** Piezas cargadas por presentacion ese dia (de `cargasAceptadasDelDia`). */
  private cargadasDelDia(dia: DiaVendedor, db: Kysely<DB>) {
    return this.cargasAceptadasDelDia(dia, db)
      .select([
        'cd.presentacion_id as presentacion_id',
        sql<number>`sum(cd.piezas)::int`.as('piezas'),
      ])
      .groupBy('cd.presentacion_id');
  }

  /**
   * Todas las presentaciones activas mas las que tengan retorno o carga aceptada
   * ese dia aunque ya no esten activas, en el orden del catalogo de la
   * produccion (producto, `volumen`, id).
   */
  async lineasDelDia(
    dia: DiaVendedor,
    db: Kysely<DB> = this.db,
  ): Promise<LineaRetorno[]> {
    return db
      .selectFrom('presentacion as pr')
      .innerJoin('producto as p', 'p.id', 'pr.producto_id')
      .leftJoin('retorno as rt', (join) =>
        join
          .onRef('rt.presentacion_id', '=', 'pr.id')
          .on('rt.vendedor_id', '=', dia.vendedorId)
          .on(sql<boolean>`rt.fecha = ${dia.fecha}::date`)
          .on('rt.deleted_at', 'is', null),
      )
      .leftJoin(this.cargadasDelDia(dia, db).as('cg'), (join) =>
        join.onRef('cg.presentacion_id', '=', 'pr.id'),
      )
      .select([
        'pr.id as presentacionId',
        'p.nombre as producto',
        'pr.volumen as presentacion',
        ACTIVA.as('activa'),
        sql<number>`coalesce(rt.piezas, 0)`.as('piezas'),
        sql<number>`coalesce(cg.piezas, 0)`.as('cargadas'),
      ])
      .where((eb) =>
        eb.or([
          ACTIVA,
          eb('rt.id', 'is not', null),
          eb('cg.presentacion_id', 'is not', null),
        ]),
      )
      .orderBy('p.nombre')
      .orderBy('pr.volumen')
      .orderBy('pr.id')
      .execute();
  }

  /** El ultimo cambio del dia (altas, correcciones y bajas); `null` si nunca se capturo. */
  async actualizadoEn(
    dia: DiaVendedor,
    db: Kysely<DB> = this.db,
  ): Promise<Date | null> {
    const r = await db
      .selectFrom('retorno')
      .select(sql<Date | null>`max(updated_at)`.as('ultimo'))
      .where('vendedor_id', '=', dia.vendedorId)
      .where(sql<boolean>`fecha = ${dia.fecha}::date`)
      .executeTakeFirst();
    return r?.ultimo ?? null;
  }
}
