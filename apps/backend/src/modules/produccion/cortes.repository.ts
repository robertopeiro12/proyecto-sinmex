import { Inject, Injectable } from '@nestjs/common';
import { sql, type Kysely, type Transaction } from 'kysely';
import { DB_CONNECTION, type Database } from '../../database/database.tokens';
import type { DB } from '../../database/schema';
import { buscarSucursalUsuario } from '../sucursales/buscar-sucursal-usuario';
import type {
  ConteoPedido,
  ConteoVivo,
  MovimientoPresentacion,
} from './reglas-corte';

/** El vendedor (vivo, activo o no) con su sucursal: el alcance y la `sucursal_id` del corte. */
export interface VendedorCorte {
  id: string;
  nombre: string;
  sucursalId: string;
  sucursalCodigo: string;
}

/** El encabezado vivo del corte: cuando se hizo y quien. */
export interface EncabezadoCorte {
  hechoEn: string;
  hechoPor: string;
}

/** Un vendedor de la lista del dia, con su encabezado si ya se hizo el corte. */
export interface VendedorDelDia extends VendedorCorte {
  hechoEn: string | null;
}

/** Los movimientos de una presentacion de un vendedor. */
export interface MovimientoVendedor extends MovimientoPresentacion {
  vendedorId: string;
}

/** Que dia de que vendedor. */
export interface DiaVendedor {
  vendedorId: string;
  /** `AAAA-MM-DD`. */
  fecha: string;
}

/**
 * SQL del corte de mercancia. Los metodos que escriben reciben la `trx` del
 * servicio; ninguno abre la suya. Cargas y ventas solo se leen.
 */
@Injectable()
export class CortesRepository {
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
  ): Promise<VendedorCorte | undefined> {
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
   * (cuando aun no hay encabezado ni filas de `retorno` que bloquear).
   * `for no key update` no frena los inserts que solo lo referencian. El
   * candado va sobre `vendedor` sola: con un join bloquearia la sucursal.
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

  /** Las filas vivas de `retorno` del dia, bloqueadas, ya con el vendedor bloqueado. */
  async bloquearVivas(
    dia: DiaVendedor,
    trx: Transaction<DB>,
  ): Promise<ConteoVivo[]> {
    return trx
      .selectFrom('retorno')
      .select([
        'id',
        'presentacion_id as presentacionId',
        'piezas as buenas',
        'piezas_merma as merma',
      ])
      .where('vendedor_id', '=', dia.vendedorId)
      .where(sql<boolean>`fecha = ${dia.fecha}::date`)
      .where('deleted_at', 'is', null)
      .forUpdate()
      .execute();
  }

  /** De esos ids, las presentaciones vivas de un producto vivo (activo o no). */
  async idsVivos(
    ids: readonly string[],
    trx: Transaction<DB>,
  ): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const filas = await trx
      .selectFrom('presentacion as pr')
      .innerJoin('producto as p', 'p.id', 'pr.producto_id')
      .select('pr.id as id')
      .where('pr.id', 'in', [...ids])
      .where('pr.deleted_at', 'is', null)
      .where('p.deleted_at', 'is', null)
      .execute();
    return new Set(filas.map((f) => f.id));
  }

  async insertar(
    dia: DiaVendedor,
    sucursalId: string,
    lineas: readonly ConteoPedido[],
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
          piezas: l.buenas,
          piezas_merma: l.merma,
          capturo_usuario_id: usuarioId,
        })),
      )
      .execute();
  }

  async actualizar(
    cambios: readonly { id: string; buenas: number; merma: number }[],
    usuarioId: string,
    trx: Transaction<DB>,
  ): Promise<void> {
    for (const c of cambios) {
      await trx
        .updateTable('retorno')
        .set({
          piezas: c.buenas,
          piezas_merma: c.merma,
          actualizado_por_usuario_id: usuarioId,
        })
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
   * Deja el corte hecho: crea el encabezado al primer guardado y en los
   * siguientes solo anota quien lo corrigio (el trigger mueve `updated_at`).
   * Con el vendedor bloqueado nadie mas escribe este encabezado.
   */
  async marcarHecho(
    dia: DiaVendedor,
    sucursalId: string,
    usuarioId: string,
    trx: Transaction<DB>,
  ): Promise<void> {
    const actualizado = await trx
      .updateTable('corte_mercancia')
      .set({ actualizado_por_usuario_id: usuarioId })
      .where('vendedor_id', '=', dia.vendedorId)
      .where(sql<boolean>`fecha = ${dia.fecha}::date`)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (Number(actualizado.numUpdatedRows) > 0) return;
    await trx
      .insertInto('corte_mercancia')
      .values({
        fecha: sql<Date>`${dia.fecha}::date`,
        vendedor_id: dia.vendedorId,
        sucursal_id: sucursalId,
        hecho_por_usuario_id: usuarioId,
      })
      .execute();
  }

  /** El encabezado vivo del corte de ese dia, o `undefined` si no se ha hecho. */
  async encabezado(
    dia: DiaVendedor,
    db: Kysely<DB> = this.db,
  ): Promise<EncabezadoCorte | undefined> {
    return db
      .selectFrom('corte_mercancia as cm')
      .innerJoin('usuario as u', 'u.id', 'cm.hecho_por_usuario_id')
      .select([
        // Hora de Tijuana ya formateada: el portal no adivina la zona (lib/formato.ts).
        sql<string>`to_char(cm.hecho_en at time zone 'America/Tijuana', 'YYYY-MM-DD HH24:MI')`.as(
          'hechoEn',
        ),
        'u.nombre as hechoPor',
      ])
      .where('cm.vendedor_id', '=', dia.vendedorId)
      .where(sql<boolean>`cm.fecha = ${dia.fecha}::date`)
      .where('cm.deleted_at', 'is', null)
      .executeTakeFirst();
  }

  /**
   * Las lineas de las cargas **aceptadas** y vivas de ese dia (pendientes,
   * rechazadas y dadas de baja no cuentan). `carga_detalle` no tiene baja
   * logica: editar una carga reemplaza sus lineas. La misma suma que usaba
   * Retorno como referencia.
   */
  private cargasAceptadasDelDia(fecha: string, db: Kysely<DB>) {
    return db
      .selectFrom('carga as c')
      .innerJoin('carga_detalle as cd', 'cd.carga_id', 'c.id')
      .select([
        'c.vendedor_id as vendedor_id',
        'cd.presentacion_id as presentacion_id',
        'cd.piezas as piezas',
      ])
      .where(sql<boolean>`c.fecha = ${fecha}::date`)
      .where('c.estado', '=', 'aceptada')
      .where('c.deleted_at', 'is', null);
  }

  /**
   * Por vendedor y presentacion, lo cargado (cargas aceptadas), lo vendido y
   * regalado (lineas vivas de ventas vivas con esa `fecha`, de cualquier status;
   * las de mostrador no tienen vendedor y no cuentan) y lo contado (filas vivas
   * de `retorno`). Solo salen las presentaciones con algun movimiento, aunque
   * esten desactivadas o dadas de baja. Vendidas se leen en vivo: editar o
   * eliminar una venta (T-17) cambia el teorico.
   *
   * `filtro`: un vendedor, o una sucursal por codigo (`null` = todas). Siempre
   * vendedores vivos; la sucursal es la del vendedor.
   */
  async movimientos(
    fecha: string,
    filtro: { vendedorId: string } | { sucursalCodigo: string | null },
    db: Kysely<DB> = this.db,
  ): Promise<MovimientoVendedor[]> {
    const condicion =
      'vendedorId' in filtro
        ? sql`v.id = ${filtro.vendedorId}`
        : filtro.sucursalCodigo === null
          ? sql`true`
          : sql`s.codigo = ${filtro.sucursalCodigo}`;
    const r = await sql<MovimientoVendedor>`
      with mov as (
        select cg.vendedor_id, cg.presentacion_id,
               cg.piezas as cargadas, 0 as vendidas, 0 as regaladas, 0 as buenas, 0 as merma
          from (${this.cargasAceptadasDelDia(fecha, db)}) cg
        union all
        select vn.vendedor_id, d.presentacion_id,
               0, d.cantidad, d.cantidad_promocion, 0, 0
          from venta_nota vn
          join venta_nota_detalle d on d.venta_nota_id = vn.id
         where vn.fecha = ${fecha}::date
           and vn.vendedor_id is not null
           and vn.deleted_at is null
           and d.deleted_at is null
        union all
        select rt.vendedor_id, rt.presentacion_id,
               0, 0, 0, rt.piezas, rt.piezas_merma
          from retorno rt
         where rt.fecha = ${fecha}::date
           and rt.deleted_at is null
      )
      select m.vendedor_id as "vendedorId",
             m.presentacion_id as "presentacionId",
             p.nombre || ' ' || pr.volumen as nombre,
             sum(m.cargadas)::int as cargadas,
             sum(m.vendidas)::int as vendidas,
             sum(m.regaladas)::int as regaladas,
             sum(m.buenas)::int as buenas,
             sum(m.merma)::int as merma
        from mov m
        join vendedor v on v.id = m.vendedor_id
        join sucursal s on s.id = v.sucursal_id
        join presentacion pr on pr.id = m.presentacion_id
        join producto p on p.id = pr.producto_id
       where v.deleted_at is null
         and ${condicion}
       group by m.vendedor_id, m.presentacion_id, p.nombre, pr.volumen
       order by p.nombre, pr.volumen, m.presentacion_id
    `.execute(db);
    return r.rows;
  }

  /**
   * Los vendedores vivos de la lista del dia (D11): los que tienen movimientos
   * (`conMovimiento`) o un corte vivo ese dia. Orden sucursal, nombre.
   */
  async vendedoresDelDia(
    fecha: string,
    sucursalCodigo: string | null,
    conMovimiento: readonly string[],
  ): Promise<VendedorDelDia[]> {
    return this.db
      .selectFrom('vendedor as v')
      .innerJoin('sucursal as s', 's.id', 'v.sucursal_id')
      .leftJoin('corte_mercancia as cm', (join) =>
        join
          .onRef('cm.vendedor_id', '=', 'v.id')
          .on(sql<boolean>`cm.fecha = ${fecha}::date`)
          .on('cm.deleted_at', 'is', null),
      )
      .select([
        'v.id as id',
        'v.nombre as nombre',
        's.id as sucursalId',
        's.codigo as sucursalCodigo',
        sql<string>`to_char(cm.hecho_en at time zone 'America/Tijuana', 'YYYY-MM-DD HH24:MI')`.as(
          'hechoEn',
        ),
      ])
      .where('v.deleted_at', 'is', null)
      .$if(sucursalCodigo !== null, (qb) =>
        qb.where('s.codigo', '=', sucursalCodigo as string),
      )
      .where((eb) =>
        conMovimiento.length === 0
          ? eb('cm.id', 'is not', null)
          : eb.or([
              eb('cm.id', 'is not', null),
              eb('v.id', 'in', [...conMovimiento]),
            ]),
      )
      .orderBy('s.codigo')
      .orderBy('v.nombre')
      .orderBy('v.id')
      .execute();
  }
}
