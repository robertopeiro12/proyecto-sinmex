import { Injectable } from '@nestjs/common';
import { sql, type Transaction } from 'kysely';
import type { DB } from '../../database/schema';
import type { MetodoPago } from './datos-cobranza';
import type { TipoAbono } from './reglas-cobranza';

/** La nota elegida y a quien pertenece, para decidir `nota-no-encontrada` (D10). */
export interface NotaParaCobro {
  id: string;
  clienteId: string;
  /** La sucursal del CLIENTE: es la que define el alcance, como en el pull. */
  sucursalId: string;
}

/** Una nota del cliente ya bloqueada `for update`. */
export interface NotaBloqueada {
  id: string;
  /** `AAAA-MM-DD` con `to_char`: un `date` leido como `Date` se corre un dia. */
  fecha: string;
  folio: string;
  status: string;
  borrada: boolean;
  /** Texto `numeric` tal cual lo manda `pg`. */
  montoTotal: string;
}

/** Una fila de `cobranza_abono` lista para escribir. El dinero ya viene como texto (`aPesos`). */
export interface NuevoAbono {
  ventaNotaId: string;
  vendedorId: string;
  fechaPago: string;
  fechaOperacion: string;
  monto: string;
  tipo: TipoAbono;
  saldoPendiente: string;
  metodoPago: MetodoPago;
  folio: string | null;
  origen: 'cobro' | 'venta_contado';
}

export interface NuevoSaldoFavor {
  clienteId: string;
  vendedorId: string | null;
  /** Texto `numeric`, positivo. */
  monto: string;
  folio: string | null;
  fechaOperacion: string;
}

/**
 * SQL de la cobranza (T-20).
 *
 * Como `VentasRepository`: todo metodo recibe la `trx` y ninguno abre la suya,
 * porque el cobro entra o sale junto con su fila del buzon (ADR-0009 §2.3).
 */
@Injectable()
export class CobranzasRepository {
  /**
   * La nota elegida, **incluso borrada**: una nota borrada no se rechaza (D9),
   * solo deja de recibir dinero en el reparto.
   */
  async notaParaCobro(
    ventaNotaId: string,
    trx: Transaction<DB>,
  ): Promise<NotaParaCobro | undefined> {
    const fila = await trx
      .selectFrom('venta_nota as vn')
      .innerJoin('cliente as c', 'c.id', 'vn.cliente_id')
      .select(['vn.id', 'vn.cliente_id', 'c.sucursal_id'])
      .where('vn.id', '=', ventaNotaId)
      .executeTakeFirst();
    return fila
      ? {
          id: fila.id,
          clienteId: fila.cliente_id,
          sucursalId: fila.sucursal_id,
        }
      : undefined;
  }

  /**
   * Bloquea `for update`, en orden de `id`, las notas que pueden recibir dinero
   * y la elegida (D13).
   *
   * El orden fijo es lo que evita el deadlock entre dos cobros del mismo
   * cliente; si aun asi Postgres elige victima, `reintentarAnteConflicto`
   * repite la operacion entera. Con READ COMMITTED, las consultas que siguen al
   * candado ya ven los abonos que el otro cobro confirmo.
   */
  async bloquearNotasDelCliente(
    clienteId: string,
    notaElegidaId: string,
    trx: Transaction<DB>,
  ): Promise<NotaBloqueada[]> {
    const filas = await sql<{
      id: string;
      fecha: string;
      folio: string;
      status: string;
      borrada: boolean;
      monto_total: string;
    }>`
      select id, to_char(fecha, 'YYYY-MM-DD') as fecha, folio, status,
             deleted_at is not null as borrada, monto_total
        from venta_nota
       where cliente_id = ${clienteId}
         and ((status in ('pendiente', 'abonado') and deleted_at is null)
              or id = ${notaElegidaId})
       order by id
         for update
    `.execute(trx);

    return filas.rows.map((f) => ({
      id: f.id,
      fecha: f.fecha,
      folio: f.folio,
      status: f.status,
      borrada: f.borrada,
      montoTotal: f.monto_total,
    }));
  }

  /** Suma de los abonos vivos por nota, como texto `numeric`. Una nota sin abonos no aparece. */
  async abonadoPorNota(
    ids: readonly string[],
    trx: Transaction<DB>,
  ): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const filas = await trx
      .selectFrom('cobranza_abono')
      .select(['venta_nota_id', sql<string>`sum(monto)::text`.as('abonado')])
      .where('venta_nota_id', 'in', ids)
      .where('deleted_at', 'is', null)
      .groupBy('venta_nota_id')
      .execute();
    return new Map(filas.map((f) => [f.venta_nota_id, f.abonado]));
  }

  async insertarAbono(
    abono: NuevoAbono,
    trx: Transaction<DB>,
  ): Promise<string> {
    const fila = await trx
      .insertInto('cobranza_abono')
      .values({
        venta_nota_id: abono.ventaNotaId,
        vendedor_id: abono.vendedorId,
        fecha_pago: abono.fechaPago,
        fecha_operacion: abono.fechaOperacion,
        monto: abono.monto,
        tipo: abono.tipo,
        saldo_pendiente: abono.saldoPendiente,
        metodo_pago: abono.metodoPago,
        folio: abono.folio,
        origen: abono.origen,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return fila.id;
  }

  /**
   * Status tras el reparto (D8). Se escribe aunque no cambie: el trigger
   * `set_updated_at` le toca `updated_at` y asi el pull incremental la ve (D12).
   */
  async actualizarStatusNota(
    ventaNotaId: string,
    status: 'pagada' | 'abonado',
    trx: Transaction<DB>,
  ): Promise<void> {
    await trx
      .updateTable('venta_nota')
      .set({ status })
      .where('id', '=', ventaNotaId)
      .execute();
  }

  /**
   * Movimiento de saldo a favor (D5) y `updated_at` del cliente, para que el
   * pull incremental le baje el saldo nuevo a la tablet (D12).
   */
  async insertarSaldoFavor(
    movimiento: NuevoSaldoFavor,
    trx: Transaction<DB>,
  ): Promise<string> {
    const fila = await trx
      .insertInto('saldo_favor_movimiento')
      .values({
        cliente_id: movimiento.clienteId,
        vendedor_id: movimiento.vendedorId,
        monto: movimiento.monto,
        origen: 'excedente_cobro',
        folio: movimiento.folio,
        fecha_operacion: movimiento.fechaOperacion,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    await trx
      .updateTable('cliente')
      .set({ updated_at: sql`now()` })
      .where('id', '=', movimiento.clienteId)
      .execute();

    return fila.id;
  }
}
