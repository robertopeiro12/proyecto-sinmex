import { Inject, Injectable } from '@nestjs/common';
import type { Transaction } from 'kysely';
import { DB_CONNECTION, type Database } from '../../database/database.tokens';
import type { DB } from '../../database/schema';
import { aPesos } from '../sincronizacion/dinero';
import type { TipoEgreso } from './tipos-egreso';

/** Una fila de `gasto` lista para escribir. */
export interface NuevoGasto {
  id: string;
  sucursalId: string;
  vendedorId: string | null;
  campoEgresoId: string;
  campoNombre: string;
  tipo: TipoEgreso;
  /** `AAAA-MM-DD`: la `fecha_operacion` del sobre, tal cual. */
  fecha: string;
  registradoEn: string;
  montoCentavos: number;
  metodo: 'efectivo_cobranza_dia';
  origen: 'app' | 'portal';
  quien: string | null;
  comentario: string | null;
}

/**
 * SQL de los gastos (T-30/T-31). Lo del push recibe la `trx` y no abre la suya:
 * el gasto entra o sale junto con su fila del buzon (ADR-0009 §2.3).
 */
@Injectable()
export class GastosRepository {
  constructor(@Inject(DB_CONNECTION) private readonly db: Database) {}

  /**
   * Nombre y tipo del campo, para copiarlos al gasto (D4). **Sin mirar
   * `deleted_at`** a proposito (D5): uno dado de baja despues de que el
   * vendedor lo eligio sin red se acepta.
   */
  async campoParaGasto(
    campoId: string,
    trx: Transaction<DB>,
  ): Promise<{ nombre: string; tipo: TipoEgreso } | undefined> {
    const fila = await trx
      .selectFrom('campo_egreso')
      .select(['nombre', 'tipo'])
      .where('id', '=', campoId)
      .executeTakeFirst();
    // El check `ck_campo_egreso_tipo` garantiza uno de los tres.
    return fila
      ? { nombre: fila.nombre, tipo: fila.tipo as TipoEgreso }
      : undefined;
  }

  /** El nombre del vendedor para `gasto.quien`; `null` si ya no existe. */
  async nombreVendedor(
    vendedorId: string,
    trx: Transaction<DB>,
  ): Promise<string | null> {
    const fila = await trx
      .selectFrom('vendedor')
      .select('nombre')
      .where('id', '=', vendedorId)
      .executeTakeFirst();
    return fila?.nombre ?? null;
  }

  /**
   * Inserta el gasto, o devuelve `null` si su id ya estaba ocupado.
   *
   * `on conflict (id) do nothing` y no atrapar el `23505`: un unique_violation
   * aborta la transaccion entera de Postgres (T-16, D10).
   */
  async insertar(
    nuevo: NuevoGasto,
    trx: Transaction<DB>,
  ): Promise<string | null> {
    const fila = await trx
      .insertInto('gasto')
      .values({
        id: nuevo.id,
        sucursal_id: nuevo.sucursalId,
        vendedor_id: nuevo.vendedorId,
        campo_egreso_id: nuevo.campoEgresoId,
        campo_nombre: nuevo.campoNombre,
        tipo: nuevo.tipo,
        // El 'AAAA-MM-DD' del sobre tal cual, sin pasar por Date/UTC.
        fecha: nuevo.fecha,
        registrado_en: nuevo.registradoEn,
        // Centavos enteros a texto exacto: nunca un flotante a `numeric`.
        monto: aPesos(nuevo.montoCentavos),
        metodo: nuevo.metodo,
        origen: nuevo.origen,
        quien: nuevo.quien,
        comentario: nuevo.comentario,
      })
      .onConflict((oc) => oc.column('id').doNothing())
      .returning('id')
      .executeTakeFirst();
    return fila?.id ?? null;
  }

  /** ¿Sigue existiendo ese gasto (vivo)? Antes de escribir su foto en disco. */
  async existe(id: string): Promise<boolean> {
    const fila = await this.db
      .selectFrom('gasto')
      .select('id')
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    return fila !== undefined;
  }

  /**
   * Anota la foto del ticket (nombre y fecha juntos, `ck_gasto_foto_completa`).
   * `false` si la fila ya no estaba o se dio de baja.
   */
  async anotarFoto(
    id: string,
    archivo: string,
    subidaEn: Date,
  ): Promise<boolean> {
    const fila = await this.db
      .updateTable('gasto')
      .set({ foto_archivo: archivo, foto_subida_en: subidaEn })
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .returning('id')
      .executeTakeFirst();
    return fila !== undefined;
  }
}
