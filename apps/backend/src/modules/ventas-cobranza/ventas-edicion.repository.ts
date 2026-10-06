import { Injectable } from '@nestjs/common';
import { sql, type Transaction } from 'kysely';
import type { DB } from '../../database/schema';
import { aCentavos, aPesos } from '../sincronizacion/dinero';
import type { FacturaVenta } from './datos-venta';
import type { LineaGuardada, PlanDetalle } from './edicion-venta';
import type { ContadoCredito, StatusInicial } from './reglas-venta';
import type { MetodoPagoContado, OrigenVenta } from './ventas.service';

/** La venta viva, ya bloqueada `for update`. */
export interface VentaBloqueada {
  id: string;
  folio: string;
  /** `AAAA-MM-DD` con `to_char`. */
  fecha: string;
  clienteId: string;
  vendedorId: string | null;
  sucursalId: string;
  sucursalCodigo: string;
  status: string;
  origen: OrigenVenta;
  /** Texto `numeric(5,2)` tal cual lo manda `pg`, o `null`. */
  pctComision: string | null;
}

export interface CambiosCabecera {
  vendedorId: string | null;
  numNota: string;
  contadoCredito: ContadoCredito;
  factura: FacturaVenta;
  comentarios: string | null;
  /** Texto `numeric`, ya con `aPesos`. */
  montoTotal: string;
  status: StatusInicial;
  pctComision: string | null;
  usuarioId: string;
}

/**
 * SQL de la edicion, el borrado y la cuenta perdida (T-17 parte 2).
 *
 * Como `VentasRepository`: todo metodo recibe la `trx` y ninguno abre la suya;
 * la abre `VentasEdicionService`, que bloquea la venta primero.
 */
@Injectable()
export class VentasEdicionRepository {
  /**
   * `for update OF vn`: bloquea solo la venta, no la sucursal del join. Es lo
   * que serializa la edicion contra un cobro de la tablet en vuelo, que
   * bloquea las notas del cliente con `for update` (`CobranzasRepository`).
   */
  async bloquearVenta(
    id: string,
    trx: Transaction<DB>,
  ): Promise<VentaBloqueada | undefined> {
    const filas = await sql<{
      id: string;
      folio: string;
      fecha: string;
      cliente_id: string;
      vendedor_id: string | null;
      sucursal_id: string;
      codigo: string;
      status: string;
      origen: string;
      pct_comision: string | null;
    }>`
      select vn.id, vn.folio, to_char(vn.fecha, 'YYYY-MM-DD') as fecha,
             vn.cliente_id, vn.vendedor_id, vn.sucursal_id, s.codigo,
             vn.status, vn.origen, vn.pct_comision
        from venta_nota vn
        join sucursal s on s.id = vn.sucursal_id
       where vn.id = ${id}
         and vn.deleted_at is null
         for update of vn
    `.execute(trx);
    const f = filas.rows[0];
    if (!f) return undefined;
    return {
      id: f.id,
      folio: f.folio,
      fecha: f.fecha,
      clienteId: f.cliente_id,
      vendedorId: f.vendedor_id,
      sucursalId: f.sucursal_id,
      sucursalCodigo: f.codigo,
      status: f.status,
      origen: f.origen as OrigenVenta,
      pctComision: f.pct_comision,
    };
  }

  /** Abonos vivos de COBRANZA. El cobro automatico de contado no cuenta. */
  async abonosDeCobroVivos(id: string, trx: Transaction<DB>): Promise<number> {
    const fila = await trx
      .selectFrom('cobranza_abono')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .where('venta_nota_id', '=', id)
      .where('origen', '=', 'cobro')
      .where('deleted_at', 'is', null)
      .executeTakeFirstOrThrow();
    return Number(fila.n);
  }

  async lineasGuardadas(
    id: string,
    trx: Transaction<DB>,
  ): Promise<LineaGuardada[]> {
    const filas = await trx
      .selectFrom('venta_nota_detalle')
      .select([
        'id',
        'presentacion_id',
        'cantidad',
        'cantidad_promocion',
        'precio',
      ])
      .where('venta_nota_id', '=', id)
      .where('deleted_at', 'is', null)
      .execute();
    return filas.map((f) => ({
      id: f.id,
      presentacionId: f.presentacion_id,
      cantidad: f.cantidad,
      cantidadPromocion: f.cantidad_promocion,
      precioCentavos: aCentavos(f.precio),
    }));
  }

  /** El metodo del cobro de contado vivo, para conservarlo si el portal no manda otro (§4.2). */
  async metodoCobroContado(
    id: string,
    trx: Transaction<DB>,
  ): Promise<MetodoPagoContado | undefined> {
    const fila = await trx
      .selectFrom('cobranza_abono')
      .select('metodo_pago')
      .where('venta_nota_id', '=', id)
      .where('origen', '=', 'venta_contado')
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    const metodo = fila?.metodo_pago;
    return metodo === 'efectivo' || metodo === 'transferencia'
      ? metodo
      : undefined;
  }

  /** El % del cliente HOY (texto `numeric`), aunque el cliente este dado de baja. */
  async pctComisionDelCliente(
    clienteId: string,
    trx: Transaction<DB>,
  ): Promise<string | null> {
    const fila = await trx
      .selectFrom('cliente')
      .select('pct_comision')
      .where('id', '=', clienteId)
      .executeTakeFirst();
    return fila?.pct_comision ?? null;
  }

  /** Folio, cliente, fecha, sucursal, origen y `capturo_usuario_id` no se tocan nunca. */
  async actualizarCabecera(
    id: string,
    cambios: CambiosCabecera,
    trx: Transaction<DB>,
  ): Promise<void> {
    await trx
      .updateTable('venta_nota')
      .set({
        vendedor_id: cambios.vendedorId,
        num_nota: cambios.numNota,
        contado_credito: cambios.contadoCredito,
        factura: cambios.factura,
        comentarios: cambios.comentarios,
        monto_total: cambios.montoTotal,
        status: cambios.status,
        pct_comision: cambios.pctComision,
        actualizado_por_usuario_id: cambios.usuarioId,
      })
      .where('id', '=', id)
      .execute();
  }

  async borrarLineas(
    ids: readonly string[],
    trx: Transaction<DB>,
  ): Promise<void> {
    if (ids.length === 0) return;
    await trx
      .updateTable('venta_nota_detalle')
      .set({ deleted_at: sql`now()` })
      .where('id', 'in', ids)
      .execute();
  }

  async actualizarLineas(
    lineas: PlanDetalle['actualizar'],
    trx: Transaction<DB>,
  ): Promise<void> {
    for (const l of lineas) {
      await trx
        .updateTable('venta_nota_detalle')
        .set({
          cantidad: l.cantidad,
          cantidad_promocion: l.cantidadPromocion,
          precio: aPesos(l.precioCentavos),
        })
        .where('id', '=', l.id)
        .execute();
    }
  }

  /** El cobro automatico de contado vivo, si lo hay (§4.2 paso 8). */
  async borrarCobroContado(id: string, trx: Transaction<DB>): Promise<void> {
    await trx
      .updateTable('cobranza_abono')
      .set({ deleted_at: sql`now()` })
      .where('venta_nota_id', '=', id)
      .where('origen', '=', 'venta_contado')
      .where('deleted_at', 'is', null)
      .execute();
  }
}
