import { Injectable } from '@nestjs/common';
import type { Transaction } from 'kysely';
import type { DB } from '../../database/schema';
import type {
  LineaMovimientoNormalizada,
  TipoMovimiento,
} from './datos-movimiento';

/** Una fila de `movimiento_inventario` lista para escribir. */
export interface NuevoMovimiento {
  id: string;
  sucursalId: string;
  vendedorId: string;
  clienteId: string | null;
  tipo: TipoMovimiento;
  /** `AAAA-MM-DD`: la `fecha_operacion` del sobre, tal cual. */
  fecha: string;
  comentario: string | null;
  registradoEn: string;
}

/**
 * SQL de los movimientos de inventario (T-27 pieza 2). Lo del push recibe la
 * `trx` y no abre la suya: el movimiento entra o sale junto con su fila del
 * buzon (ADR-0009 §2.3). La pieza 3 (corte) le sumara las lecturas.
 */
@Injectable()
export class MovimientosRepository {
  /**
   * Cuales de esas presentaciones existen. **Sin mirar `deleted_at` ni
   * `activo`**: una dada de baja despues de que el vendedor la saco de la
   * camioneta se acepta; solo un id que nunca existio es un error.
   */
  async presentacionesExistentes(
    ids: readonly string[],
    trx: Transaction<DB>,
  ): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const filas = await trx
      .selectFrom('presentacion')
      .select('id')
      .where('id', 'in', ids)
      .execute();
    return new Set(filas.map((f) => f.id));
  }

  /**
   * Inserta el movimiento, o devuelve `null` si su id ya estaba ocupado.
   *
   * `on conflict (id) do nothing` y no atrapar el `23505`: un unique_violation
   * aborta la transaccion entera de Postgres (T-16, D10).
   */
  async insertar(
    nuevo: NuevoMovimiento,
    trx: Transaction<DB>,
  ): Promise<string | null> {
    const fila = await trx
      .insertInto('movimiento_inventario')
      .values({
        id: nuevo.id,
        sucursal_id: nuevo.sucursalId,
        vendedor_id: nuevo.vendedorId,
        cliente_id: nuevo.clienteId,
        tipo: nuevo.tipo,
        // El 'AAAA-MM-DD' del sobre tal cual, sin pasar por Date/UTC.
        fecha: nuevo.fecha,
        comentario: nuevo.comentario,
        registrado_en: nuevo.registradoEn,
      })
      .onConflict((oc) => oc.column('id').doNothing())
      .returning('id')
      .executeTakeFirst();
    return fila?.id ?? null;
  }

  async insertarLineas(
    movimientoId: string,
    lineas: readonly LineaMovimientoNormalizada[],
    trx: Transaction<DB>,
  ): Promise<void> {
    await trx
      .insertInto('movimiento_inventario_linea')
      .values(
        lineas.map((l) => ({
          movimiento_id: movimientoId,
          presentacion_id: l.presentacionId,
          sentido: l.sentido,
          piezas: l.piezas,
        })),
      )
      .execute();
  }
}
