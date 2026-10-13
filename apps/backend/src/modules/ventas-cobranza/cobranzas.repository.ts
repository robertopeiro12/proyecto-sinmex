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
  /** `null` si no hubo nota de papel. Solo para pintar la vista previa (T-21). */
  numNota: string | null;
  status: string;
  borrada: boolean;
  /** Texto `numeric` tal cual lo manda `pg`. */
  montoTotal: string;
}

/** Como se pago un abono: un metodo del catalogo o, al aplicar saldo a favor, `saldo_favor` (T-21). */
export type MetodoAbono = MetodoPago | 'saldo_favor';

/** Una fila de `cobranza_abono` lista para escribir. El dinero ya viene como texto (`aPesos`). */
export interface NuevoAbono {
  ventaNotaId: string;
  /** `null` = Oficina: el cobro de contado de una venta de Oficina (T-17) o un cobro del portal (T-21). */
  vendedorId: string | null;
  fechaPago: string;
  fechaOperacion: string;
  monto: string;
  tipo: TipoAbono;
  saldoPendiente: string;
  metodoPago: MetodoAbono;
  origen: 'cobro' | 'venta_contado' | 'saldo_favor';
  /** Quien lo capturo en el portal (T-21). La tablet y la venta no lo ponen (queda null). */
  capturoUsuarioId?: string | null;
  /**
   * El pago al que pertenece (T-34). Ausente o null SOLO en el cobro automatico
   * de una venta de contado, que no es un pago aparte (`ck_cobranza_abono_cobro`).
   */
  cobroId?: string | null;
}

export interface NuevoSaldoFavor {
  clienteId: string;
  vendedorId: string | null;
  /** Texto `numeric`: positivo si es excedente, negativo si es aplicacion (T-21). */
  monto: string;
  origen: 'excedente_cobro' | 'aplicacion';
  fechaOperacion: string;
  capturoUsuarioId: string | null;
  /** El pago del que sale: el excedente o la aplicacion (T-34, not null en la base). */
  cobroId: string;
}

/**
 * Un pago (T-34): lo recibido de un cliente (tablet o portal) o el saldo a
 * favor aplicado. Sus filas de `cobranza_abono` y su movimiento de saldo a
 * favor cuelgan de el con `cobro_id`; borrar un pago es borrarlo completo.
 */
export interface NuevoCobro {
  clienteId: string;
  /** El cobrador; null = Oficina, y siempre null al aplicar saldo a favor. */
  vendedorId: string | null;
  capturoUsuarioId: string | null;
  origen: 'cobro' | 'saldo_favor';
  metodoPago: MetodoAbono;
  /** Texto `numeric`: el pago completo, sobrante a saldo a favor incluido. */
  monto: string;
  fechaPago: string;
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
   * y las elegidas (D13; T-21: una o varias).
   *
   * El orden fijo es lo que evita el deadlock entre dos cobros del mismo
   * cliente; si aun asi Postgres elige victima, `reintentarAnteConflicto`
   * repite la operacion entera (tablet) o el portal responde 409. Con READ
   * COMMITTED, las consultas que siguen al candado ya ven los abonos que el
   * otro cobro confirmo. Una elegida de OTRO cliente no sale (filtro por
   * cliente): quien llama lo detecta.
   */
  async bloquearNotasDelCliente(
    clienteId: string,
    notaElegidaIds: readonly string[],
    trx: Transaction<DB>,
  ): Promise<NotaBloqueada[]> {
    const filas = await sql<{
      id: string;
      fecha: string;
      folio: string;
      num_nota: string | null;
      status: string;
      borrada: boolean;
      monto_total: string;
    }>`
      select id, to_char(fecha, 'YYYY-MM-DD') as fecha, folio, num_nota, status,
             deleted_at is not null as borrada, monto_total
        from venta_nota
       where cliente_id = ${clienteId}
         and ((status in ('pendiente', 'abonado') and deleted_at is null)
              or id = any(${[...notaElegidaIds]}::uuid[]))
       order by id
         for update
    `.execute(trx);

    return filas.rows.map((f) => ({
      id: f.id,
      fecha: f.fecha,
      folio: f.folio,
      numNota: f.num_nota,
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

  async insertarCobro(
    cobro: NuevoCobro,
    trx: Transaction<DB>,
  ): Promise<string> {
    const fila = await trx
      .insertInto('cobro')
      .values({
        cliente_id: cobro.clienteId,
        vendedor_id: cobro.vendedorId,
        capturo_usuario_id: cobro.capturoUsuarioId,
        origen: cobro.origen,
        metodo_pago: cobro.metodoPago,
        monto: cobro.monto,
        fecha_pago: cobro.fechaPago,
        fecha_operacion: cobro.fechaOperacion,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return fila.id;
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
        origen: abono.origen,
        capturo_usuario_id: abono.capturoUsuarioId ?? null,
        cobro_id: abono.cobroId ?? null,
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

  /** Movimiento de saldo a favor (D5; T-21: tambien la aplicacion, negativa) y `updated_at` del cliente, para que el pull incremental le baje el saldo nuevo a la tablet (D12). */
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
        origen: movimiento.origen,
        fecha_operacion: movimiento.fechaOperacion,
        capturo_usuario_id: movimiento.capturoUsuarioId,
        cobro_id: movimiento.cobroId,
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

  /**
   * Bloquea `for update` los movimientos vivos de saldo a favor del cliente y
   * devuelve sus montos (texto `numeric`). Se llama DESPUES de bloquear sus
   * notas, como el cobro: mismo orden de candados, sin abrazo mortal (T-21).
   * Un excedente que entre a la vez solo SUBE el saldo: no hace falta frenarlo.
   *
   * OJO: la protección real contra dos aplicaciones de saldo a favor a la vez es
   * el candado anterior sobre las notas del cliente (las dos comparten siempre
   * al menos una nota bloqueada, así que se serializan). El `for update` de
   * este método, solo, NO alcanza: bajo READ COMMITTED no ve las filas que otra
   * transacción inserta al mismo tiempo. Nadie debe quitar el candado de notas.
   */
  async bloquearSaldoFavor(
    clienteId: string,
    trx: Transaction<DB>,
  ): Promise<string[]> {
    const filas = await sql<{ monto: string }>`
      select monto
        from saldo_favor_movimiento
       where cliente_id = ${clienteId}
         and deleted_at is null
       order by id
         for update
    `.execute(trx);
    return filas.rows.map((f) => f.monto);
  }
}
