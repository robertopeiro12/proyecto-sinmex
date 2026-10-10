import { Injectable } from '@nestjs/common';
import type { Transaction } from 'kysely';
import type { DB } from '../../database/schema';

/** Una fila de `jornada` lista para escribir. */
export interface NuevaJornada {
  vendedorId: string;
  vehiculoId: string;
  sucursalId: string;
  /** `AAAA-MM-DD`: la `fecha_operacion` del sobre, tal cual. */
  fecha: string;
  kmInicial: number;
  kmFinal: number;
  abiertaEn: string;
  cerradaEn: string;
}

/**
 * SQL de la jornada (T-38).
 *
 * Como `CobranzasRepository`: todo metodo recibe la `trx` y ninguno abre la
 * suya, porque la jornada entra o sale junto con su fila del buzon (ADR-0009
 * §2.3).
 */
@Injectable()
export class JornadasRepository {
  /**
   * ¿El vehiculo existe, no esta dado de baja y es de esa sucursal?
   *
   * No mira `activo` a proposito: un vehiculo desactivado a media jornada
   * igual recorrio esos kilometros (ver `JornadasService`).
   */
  async vehiculoDeLaSucursal(
    vehiculoId: string,
    sucursalId: string,
    trx: Transaction<DB>,
  ): Promise<boolean> {
    const fila = await trx
      .selectFrom('vehiculo')
      .select('id')
      .where('id', '=', vehiculoId)
      .where('sucursal_id', '=', sucursalId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    return fila !== undefined;
  }

  /**
   * Inserta la jornada, o devuelve `null` si el vendedor ya tiene una viva ese
   * dia (`uq_jornada_vendedor_fecha`).
   *
   * `on conflict ... do nothing` y no atrapar el `23505`: un `unique_violation`
   * aborta la transaccion entera de Postgres (T-16, D10), y con esto no hay
   * nada que abortar. Si otra transaccion esta insertando el mismo dia, Postgres
   * espera a que termine y despues decide. El `where` es el predicado del indice
   * parcial: sin el, Postgres no lo puede usar como arbitro.
   */
  async insertar(
    nueva: NuevaJornada,
    trx: Transaction<DB>,
  ): Promise<string | null> {
    const fila = await trx
      .insertInto('jornada')
      .values({
        vendedor_id: nueva.vendedorId,
        vehiculo_id: nueva.vehiculoId,
        sucursal_id: nueva.sucursalId,
        fecha: nueva.fecha,
        km_inicial: nueva.kmInicial,
        km_final: nueva.kmFinal,
        abierta_en: nueva.abiertaEn,
        cerrada_en: nueva.cerradaEn,
      })
      .onConflict((oc) =>
        oc
          .columns(['vendedor_id', 'fecha'])
          .where('deleted_at', 'is', null)
          .doNothing(),
      )
      .returning('id')
      .executeTakeFirst();
    return fila?.id ?? null;
  }
}
