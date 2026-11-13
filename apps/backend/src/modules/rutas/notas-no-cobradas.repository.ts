import { Injectable } from '@nestjs/common';
import type { Transaction } from 'kysely';
import type { DB } from '../../database/schema';

/** Una fila de `nota_no_cobrada` lista para escribir. */
export interface NuevaNotaNoCobrada {
  id: string;
  ventaNotaId: string;
  vendedorId: string;
  sucursalId: string;
  /** `AAAA-MM-DD`: la `fecha_operacion` del sobre, tal cual. */
  fecha: string;
  comentario: string;
  registradoEn: string;
}

/**
 * SQL del comentario "no cobre". Como `VisitasRepository`: recibe la `trx` y
 * no abre la suya, porque el comentario entra o sale junto con su fila del buzon.
 */
@Injectable()
export class NotasNoCobradasRepository {
  /**
   * Cliente y sucursal de la nota. **Sin mirar `deleted_at`** a proposito: una
   * venta borrada despues de que el vendedor escribio el comentario sin red se
   * acepta.
   */
  async notaDe(
    ventaNotaId: string,
    trx: Transaction<DB>,
  ): Promise<{ clienteId: string; clienteSucursalId: string } | undefined> {
    const fila = await trx
      .selectFrom('venta_nota as vn')
      .innerJoin('cliente as c', 'c.id', 'vn.cliente_id')
      .select(['vn.cliente_id', 'c.sucursal_id'])
      .where('vn.id', '=', ventaNotaId)
      .executeTakeFirst();
    return fila
      ? { clienteId: fila.cliente_id, clienteSucursalId: fila.sucursal_id }
      : undefined;
  }

  /**
   * Inserta el comentario; `false` si su id ya estaba ocupado.
   *
   * `on conflict (id) do nothing` y no atrapar el `23505`: un unique_violation
   * aborta la transaccion entera de Postgres.
   */
  async insertar(
    nueva: NuevaNotaNoCobrada,
    trx: Transaction<DB>,
  ): Promise<boolean> {
    const fila = await trx
      .insertInto('nota_no_cobrada')
      .values({
        id: nueva.id,
        venta_nota_id: nueva.ventaNotaId,
        vendedor_id: nueva.vendedorId,
        sucursal_id: nueva.sucursalId,
        // El 'AAAA-MM-DD' del sobre tal cual, sin pasar por Date/UTC.
        fecha: nueva.fecha,
        comentario: nueva.comentario,
        registrado_en: nueva.registradoEn,
      })
      .onConflict((oc) => oc.column('id').doNothing())
      .returning('id')
      .executeTakeFirst();
    return fila !== undefined;
  }
}
