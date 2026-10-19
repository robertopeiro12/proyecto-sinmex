import { Inject, Injectable } from '@nestjs/common';
import type { Transaction } from 'kysely';
import { DB_CONNECTION, type Database } from '../../database/database.tokens';
import type { DB } from '../../database/schema';

/** Una fila de `visita` lista para escribir. */
export interface NuevaVisita {
  id: string;
  vendedorId: string;
  sucursalId: string;
  clienteId: string;
  motivoVisitaId: string;
  /** `AAAA-MM-DD`: la `fecha_operacion` del sobre, tal cual. */
  fecha: string;
  visitadaEn: string;
  observaciones: string | null;
  atendio: string | null;
  lat: number | null;
  lng: number | null;
  precisionM: number | null;
  direccionTexto: string | null;
}

/**
 * SQL de la visita sin venta (T-39). Como `JornadasRepository`: lo del push
 * recibe la `trx` y no abre la suya, porque la visita entra o sale junto con su
 * fila del buzon (ADR-0009 §2.3).
 */
@Injectable()
export class VisitasRepository {
  constructor(@Inject(DB_CONNECTION) private readonly db: Database) {}

  /** ¿Sigue existiendo esa visita? Antes de escribir su foto en disco. */
  async existe(id: string): Promise<boolean> {
    const fila = await this.db
      .selectFrom('visita')
      .select('id')
      .where('id', '=', id)
      .executeTakeFirst();
    return fila !== undefined;
  }

  /**
   * Anota la foto en la visita (nombre y fecha juntos, `ck_visita_foto_completa`).
   * `false` si la fila ya no estaba.
   */
  async anotarFoto(
    id: string,
    archivo: string,
    subidaEn: Date,
  ): Promise<boolean> {
    const fila = await this.db
      .updateTable('visita')
      .set({ foto_archivo: archivo, foto_subida_en: subidaEn })
      .where('id', '=', id)
      .returning('id')
      .executeTakeFirst();
    return fila !== undefined;
  }

  /**
   * ¿Existe el motivo? **Sin mirar `deleted_at`** a proposito (D3): uno dado de
   * baja despues de que el vendedor lo eligio sin red se acepta.
   */
  async motivoExiste(motivoId: string, trx: Transaction<DB>): Promise<boolean> {
    const fila = await trx
      .selectFrom('motivo_visita')
      .select('id')
      .where('id', '=', motivoId)
      .executeTakeFirst();
    return fila !== undefined;
  }

  /**
   * Inserta la visita, o devuelve `null` si su id ya estaba ocupado.
   *
   * `on conflict (id) do nothing` y no atrapar el `23505`: un unique_violation
   * aborta la transaccion entera de Postgres (T-16, D10).
   */
  async insertar(
    nueva: NuevaVisita,
    trx: Transaction<DB>,
  ): Promise<string | null> {
    const fila = await trx
      .insertInto('visita')
      .values({
        id: nueva.id,
        vendedor_id: nueva.vendedorId,
        sucursal_id: nueva.sucursalId,
        cliente_id: nueva.clienteId,
        motivo_visita_id: nueva.motivoVisitaId,
        // El 'AAAA-MM-DD' del sobre tal cual, sin pasar por Date/UTC (el
        // schema tipa la columna `date` como `Timestamp`, que admite string).
        fecha: nueva.fecha,
        visitada_en: nueva.visitadaEn,
        observaciones: nueva.observaciones,
        atendio: nueva.atendio,
        lat: nueva.lat,
        lng: nueva.lng,
        precision_m: nueva.precisionM,
        direccion_texto: nueva.direccionTexto,
      })
      .onConflict((oc) => oc.column('id').doNothing())
      .returning('id')
      .executeTakeFirst();
    return fila?.id ?? null;
  }
}
