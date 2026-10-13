import { Inject, Injectable } from '@nestjs/common';
import { sql, type Transaction } from 'kysely';
import { DB_CONNECTION, type Database } from '../../database/database.tokens';
import type { DB } from '../../database/schema';
import type { StatusNota } from './reglas-borrado-cobro';

/** Un pago con lo necesario para pintarlo y exigir el alcance (T-34). */
export interface CabeceraCobro {
  id: string;
  clienteId: string;
  /** Nombre del cliente. */
  cliente: string;
  /** La sucursal del CLIENTE: la que define el alcance, como en el cobro. */
  sucursalId: string;
  sucursalCodigo: string;
  origen: 'cobro' | 'saldo_favor';
  metodoPago: string;
  /** Texto `numeric`: el pago completo. */
  monto: string;
  /** `AAAA-MM-DD` con `to_char`: un `date` leido como `Date` se corre un dia. */
  fechaPago: string;
  fechaOperacion: string;
  /** Nombre del vendedor que cobro; `null` = Oficina (o saldo a favor). */
  cobrador: string | null;
  borrado: boolean;
}

/**
 * SQL de borrar un pago (T-34). Como `CobranzasRepository`: lo que escribe
 * recibe la `trx` de quien llama y ninguno abre la suya.
 */
@Injectable()
export class CobrosBorradoRepository {
  constructor(@Inject(DB_CONNECTION) private readonly db: Database) {}

  /**
   * El pago, **incluso borrado** (quien llama decide). Sin candado, salvo
   * `compartido`: `for share of co`, para PEDIR su borrado. Si otra transaccion
   * lo esta borrando (tiene su `for update`), espera a que confirme y lee el
   * `deleted_at` ya escrito, en vez de dejar una peticion pendiente sobre un
   * pago borrado. No choca con otro `for share` (dos que piden a la vez).
   */
  async cabecera(
    cobroId: string,
    conexion: Database = this.db,
    compartido = false,
  ): Promise<CabeceraCobro | undefined> {
    const filas = await sql<{
      id: string;
      cliente_id: string;
      cliente: string;
      sucursal_id: string;
      sucursal_codigo: string;
      origen: string;
      metodo_pago: string;
      monto: string;
      fecha_pago: string;
      fecha_operacion: string;
      cobrador: string | null;
      borrado: boolean;
    }>`
      select co.id, co.cliente_id, c.nombre as cliente, c.sucursal_id,
             s.codigo as sucursal_codigo, co.origen, co.metodo_pago,
             co.monto::text as monto,
             to_char(co.fecha_pago, 'YYYY-MM-DD') as fecha_pago,
             to_char(co.fecha_operacion, 'YYYY-MM-DD') as fecha_operacion,
             v.nombre as cobrador,
             co.deleted_at is not null as borrado
        from cobro co
        join cliente c on c.id = co.cliente_id
        join sucursal s on s.id = c.sucursal_id
        left join vendedor v on v.id = co.vendedor_id
       where co.id = ${cobroId}
       ${compartido ? sql`for share of co` : sql``}
    `.execute(conexion);
    const f = filas.rows[0];
    return f
      ? {
          id: f.id,
          clienteId: f.cliente_id,
          cliente: f.cliente,
          sucursalId: f.sucursal_id,
          sucursalCodigo: f.sucursal_codigo,
          origen: f.origen as 'cobro' | 'saldo_favor',
          metodoPago: f.metodo_pago,
          monto: f.monto,
          fechaPago: f.fecha_pago,
          fechaOperacion: f.fecha_operacion,
          cobrador: f.cobrador,
          borrado: f.borrado,
        }
      : undefined;
  }

  /** Lo que el pago le abono a cada nota (sus filas vivas), texto `numeric`. */
  async delPagoPorNota(
    cobroId: string,
    trx: Transaction<DB>,
  ): Promise<Map<string, string>> {
    const filas = await trx
      .selectFrom('cobranza_abono')
      .select(['venta_nota_id', sql<string>`sum(monto)::text`.as('monto')])
      .where('cobro_id', '=', cobroId)
      .where('deleted_at', 'is', null)
      .groupBy('venta_nota_id')
      .execute();
    return new Map(filas.map((f) => [f.venta_nota_id, f.monto]));
  }

  /** `for update` de la fila del pago: el ultimo candado (despues de notas y saldo a favor). */
  async bloquearCobro(
    cobroId: string,
    trx: Transaction<DB>,
  ): Promise<{ borrado: boolean }> {
    const filas = await sql<{ borrado: boolean }>`
      select deleted_at is not null as borrado
        from cobro
       where id = ${cobroId}
         for update
    `.execute(trx);
    const fila = filas.rows[0];
    if (!fila)
      throw new Error(`El cobro ${cobroId} desaparecio bajo el candado.`);
    return fila;
  }

  /** Su movimiento vivo de saldo a favor: + excedente, - aplicacion, `0` si no tiene. */
  async movimientoDelPago(
    cobroId: string,
    trx: Transaction<DB>,
  ): Promise<string> {
    const fila = await trx
      .selectFrom('saldo_favor_movimiento')
      .select(sql<string>`coalesce(sum(monto), 0)::text`.as('total'))
      .where('cobro_id', '=', cobroId)
      .where('deleted_at', 'is', null)
      .executeTakeFirstOrThrow();
    return fila.total;
  }

  /** El pago completo: el `cobro` (con quien lo borro), sus filas en notas y su saldo a favor. */
  async borrarPago(
    cobroId: string,
    usuarioId: string,
    trx: Transaction<DB>,
  ): Promise<void> {
    await trx
      .updateTable('cobranza_abono')
      .set({ deleted_at: sql`now()` })
      .where('cobro_id', '=', cobroId)
      .where('deleted_at', 'is', null)
      .execute();
    await trx
      .updateTable('saldo_favor_movimiento')
      .set({ deleted_at: sql`now()` })
      .where('cobro_id', '=', cobroId)
      .where('deleted_at', 'is', null)
      .execute();
    await trx
      .updateTable('cobro')
      .set({ deleted_at: sql`now()`, eliminado_por_usuario_id: usuarioId })
      .where('id', '=', cobroId)
      .execute();
  }

  // Aparte de `CobranzasRepository.actualizarStatusNota`: su status admite `pendiente`/`cuenta_perdida`; el de T-20 solo `pagada`/`abonado`.
  /**
   * El status tras borrar. Se escribe aunque no cambie: el trigger le toca
   * `updated_at` y el pull incremental de la tablet la vuelve a bajar (D12).
   */
  async escribirStatusNota(
    notaId: string,
    status: StatusNota,
    trx: Transaction<DB>,
  ): Promise<void> {
    await trx
      .updateTable('venta_nota')
      .set({ status })
      .where('id', '=', notaId)
      .execute();
  }

  /** `updated_at` del cliente: asi el pull incremental le baja el saldo a favor nuevo. */
  async tocarCliente(clienteId: string, trx: Transaction<DB>): Promise<void> {
    await trx
      .updateTable('cliente')
      .set({ updated_at: sql`now()` })
      .where('id', '=', clienteId)
      .execute();
  }
}
