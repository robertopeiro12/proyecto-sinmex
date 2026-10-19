import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DB_CONNECTION, type Database } from '../../database/database.tokens';
import type { DestinoCobranza, MetodoCobranza } from './reglas-destino';

@Injectable()
export class DestinosRepository {
  constructor(@Inject(DB_CONNECTION) private readonly db: Database) {}

  /** Vivos; `sucursalIds` null = todas. Por sucursal, metodo y `desde` (mas reciente primero). */
  async listar(sucursalIds: string[] | null): Promise<DestinoCobranza[]> {
    if (sucursalIds !== null && sucursalIds.length === 0) return [];
    let q = this.db
      .selectFrom('tesoreria_destino_cobranza as t')
      .innerJoin('sucursal as s', 's.id', 't.sucursal_id')
      .innerJoin('tesoreria_cuenta as c', 'c.id', 't.cuenta_id')
      .select([
        't.id as id',
        't.sucursal_id as sucursalId',
        's.codigo as sucursalCodigo',
        't.metodo as metodo',
        't.cuenta_id as cuentaId',
        'c.nombre as cuentaNombre',
        sql<string>`to_char(t.desde, 'YYYY-MM-DD')`.as('desde'),
      ])
      .where('t.deleted_at', 'is', null);
    if (sucursalIds !== null) q = q.where('t.sucursal_id', 'in', sucursalIds);
    const filas = await q
      .orderBy('s.codigo')
      .orderBy('t.metodo')
      .orderBy('t.desde', 'desc')
      .execute();
    return filas.map((f) => ({ ...f, metodo: f.metodo as MetodoCobranza }));
  }

  /** Agrega una vigencia o corrige la de la misma `desde` (indice parcial uq_tesoreria_destino_vigencia). */
  async guardar(
    d: {
      sucursalId: string;
      metodo: MetodoCobranza;
      cuentaId: string;
      desde: string;
    },
    usuarioId: string,
  ): Promise<void> {
    await this.db
      .insertInto('tesoreria_destino_cobranza')
      .values({
        sucursal_id: d.sucursalId,
        metodo: d.metodo,
        cuenta_id: d.cuentaId,
        desde: d.desde,
        capturo_usuario_id: usuarioId,
      })
      .onConflict((oc) =>
        oc
          .columns(['sucursal_id', 'metodo', 'desde'])
          .where('deleted_at', 'is', null)
          .doUpdateSet((eb) => ({
            cuenta_id: eb.ref('excluded.cuenta_id'),
            capturo_usuario_id: eb.ref('excluded.capturo_usuario_id'),
          })),
      )
      .execute();
  }

  /** Sucursales (activas o no) en alcance: `codigo` null = todas. */
  async sucursales(
    codigo: string | null,
  ): Promise<{ id: string; codigo: string; nombre: string }[]> {
    let q = this.db
      .selectFrom('sucursal')
      .select(['id', 'codigo', 'nombre'])
      .where('deleted_at', 'is', null);
    if (codigo !== null) q = q.where('codigo', '=', codigo);
    return q.orderBy('codigo').execute();
  }
}
