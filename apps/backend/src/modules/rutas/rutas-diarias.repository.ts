import { Inject, Injectable } from '@nestjs/common';
import { sql, type Transaction } from 'kysely';
import { DB_CONNECTION, type Database } from '../../database/database.tokens';
import type { DB } from '../../database/schema';

export type OrigenRuta = 'oficina' | 'vendedor';

/** Una fila de `ruta` diaria lista para escribir. */
export interface NuevaFilaRuta {
  vendedorId: string;
  clienteId: string;
  /** `AAAA-MM-DD`. En un alta de la tablet, la `fecha_operacion` tal cual. */
  fecha: string;
  orden: number;
  origen: OrigenRuta;
}

/**
 * SQL de la ruta diaria (T-37).
 *
 * Los metodos del push reciben la `trx` de la operacion y ninguno abre la suya:
 * el alta entra o sale junto con su fila del buzon (ADR-0009 §2.3). Los del
 * portal (Tarea 5) usan `enTransaccion`.
 */
@Injectable()
export class RutasDiariasRepository {
  constructor(@Inject(DB_CONNECTION) private readonly db: Database) {}

  /**
   * ¿El cliente existe, no esta dado de baja, es de esa sucursal y es
   * `tipo = 'cliente'`? A un prospecto no se le vende (D7), asi que no entra a
   * la ruta.
   */
  async clienteParaRuta(
    clienteId: string,
    sucursalId: string,
    trx: Transaction<DB>,
  ): Promise<boolean> {
    const fila = await trx
      .selectFrom('cliente')
      .select('id')
      .where('id', '=', clienteId)
      .where('sucursal_id', '=', sucursalId)
      .where('tipo', '=', 'cliente')
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    return fila !== undefined;
  }

  /**
   * Bloquea la fila del vendedor hasta el fin de la transaccion.
   *
   * Es el candado comun del alta (push) y del reemplazo (portal) de la ruta de
   * ese vendedor: sin el, dos transacciones calculan el mismo orden siguiente, o
   * el portal lee las vivas antes de que un alta haga commit y revienta con
   * `23505`. `for no key update` y no `for update`: no bloquea los inserts de
   * otras tablas que solo referencian al vendedor (ventas, jornada).
   */
  async bloquearVendedor(
    vendedorId: string,
    trx: Transaction<DB>,
  ): Promise<void> {
    await trx
      .selectFrom('vendedor')
      .select('id')
      .where('id', '=', vendedorId)
      .forNoKeyUpdate()
      .execute();
  }

  /** `max(orden) + 1` entre las vivas de ese vendedor y dia, o `1` si no hay. */
  async siguienteOrden(
    vendedorId: string,
    fecha: string,
    trx: Transaction<DB>,
  ): Promise<number> {
    const fila = await trx
      .selectFrom('ruta')
      .select(sql<number>`coalesce(max(orden), 0) + 1`.as('siguiente'))
      .where('vendedor_id', '=', vendedorId)
      .where(sql<boolean>`fecha = ${fecha}::date`)
      .where('tipo', '=', 'diaria')
      .where('deleted_at', 'is', null)
      .executeTakeFirstOrThrow();
    return Number(fila.siguiente);
  }

  /**
   * Inserta la fila, o devuelve `null` si ese vendedor ya tenia a ese cliente
   * vivo en la ruta diaria de ese dia (`uq_ruta_diaria_vendedor_fecha_cliente`).
   *
   * `on conflict ... do nothing` y no atrapar el `23505`: un `unique_violation`
   * aborta la transaccion entera de Postgres (T-16, D10). El predicado del
   * indice parcial va entero para que Postgres lo pueda usar como arbitro, y el
   * `tipo = 'diaria'` va LITERAL (no como parametro `$n`): la inferencia del
   * indice compara contra constantes.
   */
  async insertarSiNoExiste(
    nueva: NuevaFilaRuta,
    trx: Transaction<DB>,
  ): Promise<string | null> {
    const fila = await trx
      .insertInto('ruta')
      .values({
        vendedor_id: nueva.vendedorId,
        cliente_id: nueva.clienteId,
        fecha: nueva.fecha,
        orden: nueva.orden,
        origen: nueva.origen,
        tipo: 'diaria',
      })
      .onConflict((oc) =>
        oc
          .columns(['vendedor_id', 'fecha', 'cliente_id'])
          .where('deleted_at', 'is', null)
          .where(sql<boolean>`tipo = 'diaria'`)
          .doNothing(),
      )
      .returning('id')
      .executeTakeFirst();
    return fila?.id ?? null;
  }
}
