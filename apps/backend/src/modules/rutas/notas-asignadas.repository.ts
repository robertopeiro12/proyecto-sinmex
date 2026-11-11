import { Inject, Injectable } from '@nestjs/common';
import { sql, type Transaction } from 'kysely';
import { DB_CONNECTION, type Database } from '../../database/database.tokens';
import type { DB } from '../../database/schema';

/** La nota que se va a asignar, ya bloqueada. */
export interface NotaBloqueada {
  id: string;
  clienteId: string;
  clienteNombre: string;
  clienteSucursalId: string;
}

/** Quien trae una nota ese dia. */
export interface Asignacion {
  vendedorId: string;
  nombre: string;
}

/**
 * Escrituras y lecturas de `nota_asignada` para la ventana de notas de la Ruta
 * Diaria. Las notas con saldo salen de `NotasRutaRepository` (una sola
 * definicion); aqui solo viven las asignaciones.
 */
@Injectable()
export class NotasAsignadasRepository {
  constructor(@Inject(DB_CONNECTION) private readonly db: Database) {}

  enTransaccion<T>(tarea: (trx: Transaction<DB>) => Promise<T>): Promise<T> {
    return this.db.transaction().execute(tarea);
  }

  /** Candado de la fila del vendedor destino (el mismo de la ruta del dia). */
  async bloquearVendedor(vendedorId: string, trx: Transaction<DB>) {
    await trx
      .selectFrom('vendedor')
      .select('id')
      .where('id', '=', vendedorId)
      .forNoKeyUpdate()
      .execute();
  }

  /**
   * Bloquea la `venta_nota` (`for no key update`, solo ella) y la devuelve con
   * su cliente, aunque la venta este borrada: `viva` lo dice. `undefined` = no existe.
   */
  async bloquearNota(
    ventaNotaId: string,
    trx: Transaction<DB>,
  ): Promise<(NotaBloqueada & { viva: boolean }) | undefined> {
    const r = await sql<{
      id: string;
      cliente_id: string;
      nombre: string;
      sucursal_id: string;
      viva: boolean;
    }>`
      select vn.id, vn.cliente_id, c.nombre, c.sucursal_id,
             (vn.deleted_at is null) as viva
        from venta_nota vn
        join cliente c on c.id = vn.cliente_id
       where vn.id = ${ventaNotaId}::uuid
         for no key update of vn
    `.execute(trx);
    const f = r.rows[0];
    return (
      f && {
        id: f.id,
        clienteId: f.cliente_id,
        clienteNombre: f.nombre,
        clienteSucursalId: f.sucursal_id,
        viva: f.viva,
      }
    );
  }

  /** Los clientes de la ruta de ese vendedor y dia, en su orden. */
  async clientesDeLaRuta(
    vendedorId: string,
    fecha: string,
    trx?: Transaction<DB>,
  ): Promise<string[]> {
    const filas = await (trx ?? this.db)
      .selectFrom('ruta')
      .select('cliente_id')
      .where('vendedor_id', '=', vendedorId)
      .where(sql<boolean>`fecha = ${fecha}::date`)
      .where('tipo', '=', 'diaria')
      .where('deleted_at', 'is', null)
      .orderBy('orden')
      .execute();
    return filas.map((f) => f.cliente_id);
  }

  /** La asignacion viva de esa nota ese dia, si hay. */
  async asignacionViva(
    ventaNotaId: string,
    fecha: string,
    trx: Transaction<DB>,
  ): Promise<{ id: string; vendedorId: string } | undefined> {
    const f = await trx
      .selectFrom('nota_asignada')
      .select(['id', 'vendedor_id'])
      .where('venta_nota_id', '=', ventaNotaId)
      .where(sql<boolean>`fecha = ${fecha}::date`)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    return f && { id: f.id, vendedorId: f.vendedor_id };
  }

  async darDeBaja(
    asignacionId: string,
    usuarioId: string,
    trx: Transaction<DB>,
  ): Promise<void> {
    await trx
      .updateTable('nota_asignada')
      .set({ deleted_at: new Date(), quitada_por_usuario_id: usuarioId })
      .where('id', '=', asignacionId)
      .where('deleted_at', 'is', null)
      .execute();
  }

  async asignar(
    datos: {
      ventaNotaId: string;
      vendedorId: string;
      fecha: string;
      usuarioId: string;
    },
    trx: Transaction<DB>,
  ): Promise<void> {
    await trx
      .insertInto('nota_asignada')
      .values({
        venta_nota_id: datos.ventaNotaId,
        vendedor_id: datos.vendedorId,
        fecha: datos.fecha,
        asignada_por_usuario_id: datos.usuarioId,
      })
      .execute();
  }

  /** Los ids de las notas (ventas vivas) asignadas a ese vendedor ese dia. */
  async idsAsignadasA(vendedorId: string, fecha: string): Promise<string[]> {
    const filas = await this.db
      .selectFrom('nota_asignada as na')
      .innerJoin('venta_nota as vn', 'vn.id', 'na.venta_nota_id')
      .select('na.venta_nota_id')
      .where('na.vendedor_id', '=', vendedorId)
      .where(sql<boolean>`na.fecha = ${fecha}::date`)
      .where('na.deleted_at', 'is', null)
      .where('vn.deleted_at', 'is', null)
      .execute();
    return filas.map((f) => f.venta_nota_id);
  }

  /** Quien trae cada una de esas notas ese dia. */
  async asignacionesDe(
    ventaNotaIds: readonly string[],
    fecha: string,
  ): Promise<Map<string, Asignacion>> {
    if (ventaNotaIds.length === 0) return new Map();
    const filas = await this.db
      .selectFrom('nota_asignada as na')
      .innerJoin('vendedor as v', 'v.id', 'na.vendedor_id')
      .select(['na.venta_nota_id', 'v.id as vendedor_id', 'v.nombre'])
      .where('na.venta_nota_id', 'in', [...ventaNotaIds])
      .where(sql<boolean>`na.fecha = ${fecha}::date`)
      .where('na.deleted_at', 'is', null)
      .execute();
    return new Map(
      filas.map((f) => [
        f.venta_nota_id,
        { vendedorId: f.vendedor_id, nombre: f.nombre },
      ]),
    );
  }
}
