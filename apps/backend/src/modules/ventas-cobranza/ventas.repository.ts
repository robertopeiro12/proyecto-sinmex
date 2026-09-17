import { Injectable } from '@nestjs/common';
import type { Transaction } from 'kysely';
import type { DB } from '../../database/schema';
import type { FacturaVenta } from './datos-venta';
import type { ContadoCredito, StatusInicial } from './reglas-venta';

/** Cabecera lista para escribir. El dinero ya viene como texto `numeric` (`aPesos`). */
export interface NuevaVentaNota {
  folio: string;
  /** `fecha_operacion` tal cual llego. */
  fecha: string;
  clienteId: string;
  vendedorId: string;
  sucursalId: string;
  montoTotal: string;
  numNota: string;
  contadoCredito: ContadoCredito;
  factura: FacturaVenta;
  comentarios: string | null;
  semana: number;
  mes: number;
  status: StatusInicial;
  /** Texto `numeric(5,2)` tal cual lo devolvio `pg`, o `null`. */
  pctComision: string | null;
}

export interface NuevoDetalleVenta {
  presentacionId: string;
  cantidad: number;
  cantidadPromocion: number;
  /** Texto `numeric`, ya convertido con `aPesos`. */
  precio: string;
}

/**
 * SQL de la venta (T-16).
 *
 * Todo metodo recibe la `trx` y ninguno abre la suya: la transaccion la abre
 * quien llama (el `push` hoy, el controller del portal en T-17), porque la
 * venta tiene que entrar o salir **junto con** la fila del buzon (ADR-0009
 * §2.3). Por eso tampoco inyecta la conexion.
 */
@Injectable()
export class VentasRepository {
  /**
   * El % de comision del cliente, si es vendible desde esta sucursal.
   *
   * `pct_comision` se devuelve como el texto que manda `pg` y se escribe igual
   * en `venta_nota`: es `numeric(5,2)` en las dos columnas, y pasarlo por un
   * `number` es la puerta a un redondeo que nadie pidio (D8).
   */
  async clienteParaVenta(
    clienteId: string,
    sucursalId: string,
    trx: Transaction<DB>,
  ): Promise<{ pctComision: string | null } | undefined> {
    const fila = await trx
      .selectFrom('cliente')
      .select('pct_comision')
      .where('id', '=', clienteId)
      .where('sucursal_id', '=', sucursalId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    return fila ? { pctComision: fila.pct_comision } : undefined;
  }

  async insertarVenta(
    venta: NuevaVentaNota,
    trx: Transaction<DB>,
  ): Promise<string> {
    const fila = await trx
      .insertInto('venta_nota')
      .values({
        folio: venta.folio,
        fecha: venta.fecha,
        cliente_id: venta.clienteId,
        vendedor_id: venta.vendedorId,
        sucursal_id: venta.sucursalId,
        monto_total: venta.montoTotal,
        num_nota: venta.numNota,
        contado_credito: venta.contadoCredito,
        factura: venta.factura,
        comentarios: venta.comentarios,
        semana: venta.semana,
        mes: venta.mes,
        status: venta.status,
        pct_comision: venta.pctComision,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return fila.id;
  }

  async insertarDetalle(
    ventaNotaId: string,
    lineas: readonly NuevoDetalleVenta[],
    trx: Transaction<DB>,
  ): Promise<void> {
    await trx
      .insertInto('venta_nota_detalle')
      .values(
        lineas.map((l) => ({
          venta_nota_id: ventaNotaId,
          presentacion_id: l.presentacionId,
          cantidad: l.cantidad,
          cantidad_promocion: l.cantidadPromocion,
          precio: l.precio,
        })),
      )
      .execute();
  }
}
