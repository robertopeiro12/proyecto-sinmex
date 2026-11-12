import { ConflictException, Injectable } from '@nestjs/common';
import type { Transaction } from 'kysely';
import type { DB } from '../../database/schema';
import { movimientosDelDia } from '../produccion/cortes.repository';
import { existenciasPorPresentacion } from '../produccion/reglas-corte';
import {
  faltantesDeVentaPortal,
  mensajeFaltantes,
  type PiezasLinea,
} from './inventario-venta';
import {
  VentasPortalRepository,
  type VendedorConInventario,
} from './ventas-portal.repository';

/**
 * El candado de inventario de la venta del portal (registrar y editar): con
 * `sucursal.control_inventario` prendida, la oficina no le vende a un vendedor
 * mas de lo que trae cargado. Con la casilla apagada, o en una venta de
 * Oficina (sin vendedor), no revisa nada.
 *
 * Orden de candados (lo decide quien llama, siempre igual):
 * **`vendedor` (`for no key update`) → `venta_nota`**. Es el orden de la ruta
 * del dia (`ruta_semanal → vendedor → venta_nota`, notas asignadas) y las
 * cargas/el corte solo toman `vendedor`. Por eso la edicion bloquea al
 * vendedor ANTES de `for update of vn`: al reves, una edicion que tiene la
 * venta y espera al vendedor se abrazaria con una asignacion de notas que
 * tiene al vendedor y espera la venta. La cobranza, las facturas y el borrado
 * de la venta bloquean `venta_nota` sin tocar `vendedor`: no hay ciclo.
 */
@Injectable()
export class InventarioVentaService {
  constructor(private readonly portal: VentasPortalRepository) {}

  /**
   * El primer candado de la transaccion. Bloquea aunque la casilla este
   * apagada: asi la lectura de la casilla y de la existencia ya no cambian bajo
   * los pies de la venta.
   */
  bloquearVendedor(
    vendedorId: string,
    trx: Transaction<DB>,
  ): Promise<VendedorConInventario | undefined> {
    return this.portal.bloquearVendedorConInventario(vendedorId, trx);
  }

  /**
   * 409 si a la venta no le alcanza la existencia del vendedor en `fecha`
   * (la fecha de la venta). Llamar con el vendedor YA bloqueado y antes de
   * escribir nada (ni folio). `propias`: ver `faltantesDeVentaPortal`.
   *
   * Una carga pendiente no bloquea aqui (la app si): solo cuenta la existencia.
   */
  async exigirExistencia(
    vendedor: VendedorConInventario | undefined,
    fecha: string,
    lineas: readonly PiezasLinea[],
    propias: readonly PiezasLinea[],
    trx: Transaction<DB>,
  ): Promise<void> {
    if (!vendedor?.controlInventario) return;
    const movimientos = await movimientosDelDia(trx, fecha, {
      vendedorId: vendedor.id,
    });
    const faltantes = faltantesDeVentaPortal(
      existenciasPorPresentacion(movimientos),
      lineas,
      propias,
    );
    if (faltantes.length === 0) return;

    const nombres = new Map(
      movimientos.map((m) => [m.presentacionId, m.nombre]),
    );
    const sinMovimiento = faltantes
      .map((f) => f.presentacionId)
      .filter((id) => !nombres.has(id));
    for (const [id, n] of await this.portal.nombresDePresentaciones(
      sinMovimiento,
      trx,
    ))
      nombres.set(id, `${n.producto} ${n.volumen}`);

    throw new ConflictException(
      mensajeFaltantes(
        vendedor.nombre,
        faltantes,
        (id) => nombres.get(id) ?? 'Una presentación',
      ),
    );
  }
}
