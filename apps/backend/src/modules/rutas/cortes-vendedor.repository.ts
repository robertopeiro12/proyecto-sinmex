import { Injectable } from '@nestjs/common';
import { sql, type Transaction } from 'kysely';
import type { DB } from '../../database/schema';

/** Una fila de `corte_vendedor` lista para escribir; los jsonb en el formato del contrato. */
export interface NuevoCorteVendedor {
  id: string;
  vendedorId: string;
  sucursalId: string;
  /** `AAAA-MM-DD`: la `fecha_operacion` del sobre, tal cual. */
  fecha: string;
  efectivo: { esperado_centavos: number; traido_centavos: number };
  notas: { folio: string; traida: boolean; saldo_centavos: number }[];
  inventario: {
    renglones: { presentacion_id: string; sistema: number; contado: number }[];
    merma: { sistema: number; contado: number };
  };
  enviadoEn: string;
}

/**
 * SQL del corte del vendedor (rediseño pieza 6). Todo metodo recibe la `trx`:
 * el corte entra o sale junto con su fila del buzon (ADR-0009 §2.3).
 */
@Injectable()
export class CortesVendedorRepository {
  /**
   * Inserta el corte, o devuelve `null` si choca con **cualquier** unico: el
   * del dia (`uq_corte_vendedor_vendedor_fecha`) o el id. `on conflict do
   * nothing` sin arbitro para no abortar la transaccion con un `23505` (T-16,
   * D10); quien llama distingue el caso con `hayCorteVivo`.
   *
   * Los jsonb van con `JSON.stringify`: node-postgres manda un arreglo de JS
   * como arreglo de Postgres, no como JSON.
   */
  async insertar(
    nuevo: NuevoCorteVendedor,
    trx: Transaction<DB>,
  ): Promise<string | null> {
    const fila = await trx
      .insertInto('corte_vendedor')
      .values({
        id: nuevo.id,
        vendedor_id: nuevo.vendedorId,
        sucursal_id: nuevo.sucursalId,
        fecha: nuevo.fecha,
        efectivo: JSON.stringify(nuevo.efectivo),
        notas: JSON.stringify(nuevo.notas),
        inventario: JSON.stringify(nuevo.inventario),
        enviado_en: nuevo.enviadoEn,
      })
      .onConflict((oc) => oc.doNothing())
      .returning('id')
      .executeTakeFirst();
    return fila?.id ?? null;
  }

  /** ¿El vendedor ya tiene un corte vivo ese dia? */
  async hayCorteVivo(
    vendedorId: string,
    fecha: string,
    trx: Transaction<DB>,
  ): Promise<boolean> {
    const fila = await trx
      .selectFrom('corte_vendedor')
      .select('id')
      .where('vendedor_id', '=', vendedorId)
      .where(sql<boolean>`fecha = ${fecha}::date`)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    return fila !== undefined;
  }
}
