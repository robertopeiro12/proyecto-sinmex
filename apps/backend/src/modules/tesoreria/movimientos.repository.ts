import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DB_CONNECTION, type Database } from '../../database/database.tokens';
import { aCentavos, aPesos } from '../sincronizacion/dinero';
import type { MovimientoManual, TipoMovimiento } from './reglas-saldo';

export interface DatosMovimiento {
  tipo: TipoMovimiento;
  fecha: string;
  montoCentavos: number;
  cuentaId: string;
  cuentaDestinoId: string | null;
  comentario: string | null;
}

@Injectable()
export class MovimientosRepository {
  constructor(@Inject(DB_CONNECTION) private readonly db: Database) {}

  private consulta() {
    return this.db
      .selectFrom('tesoreria_movimiento as m')
      .innerJoin('tesoreria_cuenta as c', 'c.id', 'm.cuenta_id')
      .leftJoin('tesoreria_cuenta as d', 'd.id', 'm.cuenta_destino_id')
      .innerJoin('usuario as u', 'u.id', 'm.capturo_usuario_id')
      .select([
        'm.id as id',
        'm.tipo as tipo',
        sql<string>`to_char(m.fecha, 'YYYY-MM-DD')`.as('fecha'),
        'm.monto as monto',
        'm.cuenta_id as cuentaId',
        'c.nombre as cuentaNombre',
        'm.cuenta_destino_id as cuentaDestinoId',
        'd.nombre as cuentaDestinoNombre',
        'm.comentario as comentario',
        'u.nombre as capturo',
      ])
      .where('m.deleted_at', 'is', null);
  }

  private aMovimiento(fila: {
    id: string;
    tipo: string;
    fecha: string;
    monto: string;
    cuentaId: string;
    cuentaNombre: string;
    cuentaDestinoId: string | null;
    cuentaDestinoNombre: string | null;
    comentario: string | null;
    capturo: string;
  }): MovimientoManual {
    const { monto, tipo, ...resto } = fila;
    return {
      ...resto,
      tipo: tipo as TipoMovimiento,
      montoCentavos: aCentavos(monto),
    };
  }

  /**
   * Vivos que tocan alguna de esas cuentas (como salida o entrada), con fecha en
   * [desde, hasta] (`desde` null = desde siempre). Mas recientes primero.
   */
  async listar(
    cuentaIds: string[],
    desde: string | null,
    hasta: string,
  ): Promise<MovimientoManual[]> {
    if (cuentaIds.length === 0) return [];
    let q = this.consulta()
      .where((eb) =>
        eb.or([
          eb('m.cuenta_id', 'in', cuentaIds),
          eb('m.cuenta_destino_id', 'in', cuentaIds),
        ]),
      )
      .where('m.fecha', '<=', sql<Date>`${hasta}::date`);
    if (desde !== null) q = q.where('m.fecha', '>=', sql<Date>`${desde}::date`);
    const filas = await q
      .orderBy('m.fecha', 'desc')
      .orderBy('m.created_at', 'desc')
      .execute();
    return filas.map((f) => this.aMovimiento(f));
  }

  async buscar(id: string): Promise<MovimientoManual | undefined> {
    const fila = await this.consulta()
      .where('m.id', '=', id)
      .executeTakeFirst();
    return fila ? this.aMovimiento(fila) : undefined;
  }

  async crear(datos: DatosMovimiento, usuarioId: string): Promise<string> {
    const { id } = await this.db
      .insertInto('tesoreria_movimiento')
      .values({
        tipo: datos.tipo,
        fecha: datos.fecha,
        monto: aPesos(datos.montoCentavos),
        cuenta_id: datos.cuentaId,
        cuenta_destino_id: datos.cuentaDestinoId,
        comentario: datos.comentario,
        capturo_usuario_id: usuarioId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return id;
  }

  async actualizar(
    id: string,
    datos: Omit<DatosMovimiento, 'tipo'>,
  ): Promise<void> {
    await this.db
      .updateTable('tesoreria_movimiento')
      .set({
        fecha: datos.fecha,
        monto: aPesos(datos.montoCentavos),
        cuenta_id: datos.cuentaId,
        cuenta_destino_id: datos.cuentaDestinoId,
        comentario: datos.comentario,
      })
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .execute();
  }

  async eliminar(id: string): Promise<void> {
    await this.db
      .updateTable('tesoreria_movimiento')
      .set({ deleted_at: sql`now()` })
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .execute();
  }
}
