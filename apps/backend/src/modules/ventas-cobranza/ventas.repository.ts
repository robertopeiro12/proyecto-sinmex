import { Injectable } from '@nestjs/common';
import { sql, type Transaction } from 'kysely';
import type { DB } from '../../database/schema';
import type { FacturaVenta } from './datos-venta';
import type { ContadoCredito, StatusInicial } from './reglas-venta';
import type { OrigenVenta } from './ventas.service';

/** Cabecera lista para escribir. El dinero ya viene como texto `numeric` (`aPesos`). */
export interface NuevaVentaNota {
  folio: string;
  /** `fecha_operacion` tal cual llego. */
  fecha: string;
  clienteId: string;
  /** `null` en una venta de Oficina (T-17). */
  vendedorId: string | null;
  sucursalId: string;
  montoTotal: string;
  numNota: string | null;
  contadoCredito: ContadoCredito;
  factura: FacturaVenta;
  comentarios: string | null;
  semana: number;
  mes: number;
  status: StatusInicial;
  /** Texto `numeric(5,2)` tal cual lo devolvio `pg`, o `null`. */
  pctComision: string | null;
  /** T-17: `app` o `portal`. */
  origen: OrigenVenta;
  /** T-17: quien la capturo en el portal; `null` desde la tablet. */
  capturoUsuarioId: string | null;
}

export interface NuevoDetalleVenta {
  presentacionId: string;
  cantidad: number;
  cantidadPromocion: number;
  /** Texto `numeric`, ya convertido con `aPesos`. */
  precio: string;
}

/** Una fila de trazabilidad de `venta_nota_promocion` (T-74, D12). */
export interface NuevoRegaloVenta {
  /** `null` si la promocion no existe en el servidor (D13). */
  promocionId: string | null;
  presentacionId: string;
  cantidad: number;
  /** La frase que vio el vendedor, congelada en la nota. */
  texto: string;
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
        origen: venta.origen,
        capturo_usuario_id: venta.capturoUsuarioId,
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

  /** De una lista de ids de promocion, cuales existen (vivas o no: la trazabilidad sobrevive a la baja). */
  async promocionesExistentes(
    ids: readonly string[],
    trx: Transaction<DB>,
  ): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const filas = await trx
      .selectFrom('promocion')
      .select('id')
      .where('id', 'in', [...ids])
      .execute();
    return new Set(filas.map((f) => f.id));
  }

  async insertarRegalos(
    ventaNotaId: string,
    regalos: readonly NuevoRegaloVenta[],
    trx: Transaction<DB>,
  ): Promise<void> {
    if (regalos.length === 0) return;
    await trx
      .insertInto('venta_nota_promocion')
      .values(
        regalos.map((r) => ({
          venta_nota_id: ventaNotaId,
          promocion_id: r.promocionId,
          presentacion_id: r.presentacionId,
          cantidad: r.cantidad,
          promocion_texto: r.texto,
        })),
      )
      .execute();
  }

  /**
   * D14 (T-74): la primera nota viva del cliente lo marca, y el trigger de
   * `updated_at` hace que el pull incremental lo vuelva a bajar. Idempotente:
   * solo escribe si aun no estaba marcado, asi una segunda venta no le mueve
   * la fecha ni le toca `updated_at`.
   */
  async marcarPrimeraVenta(
    clienteId: string,
    trx: Transaction<DB>,
  ): Promise<void> {
    await trx
      .updateTable('cliente')
      .set({ primera_venta_en: sql`now()` })
      .where('id', '=', clienteId)
      .where('primera_venta_en', 'is', null)
      .execute();
  }
}
