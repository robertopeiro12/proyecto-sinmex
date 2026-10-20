import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DB_CONNECTION, type Database } from '../../database/database.tokens';
import { METODO_GASTO_RUTA } from '../compras-egresos/tipos-egreso';
import { aCentavos } from '../sincronizacion/dinero';
import type { GastoDia } from './reglas-saldo';

/**
 * T-30/T-31 (D7): los gastos de la ruta que restan en Tesoreria, LEIDOS (no
 * copiados) de la tabla `gasto` de Compras y Egresos, agrupados por dia y
 * sucursal (la del GASTO, que es la del vendedor). Solo los vivos con
 * `metodo = METODO_GASTO_RUTA`: las compras de oficina con otro metodo
 * (siguiente ticket) no salen del efectivo de la cobranza. Un gasto dado de
 * baja deja de contar solo, igual que un cobro borrado en T-29.
 */
@Injectable()
export class GastosTesoreriaRepository {
  constructor(@Inject(DB_CONNECTION) private readonly db: Database) {}

  async porDia(hasta: string): Promise<GastoDia[]> {
    const r = await sql<{
      fecha: string;
      sucursal_id: string;
      codigo: string;
      cantidad: number;
      monto: string;
    }>`
      select to_char(g.fecha, 'YYYY-MM-DD') as fecha, g.sucursal_id, s.codigo,
             count(*)::int as cantidad, sum(g.monto)::text as monto
        from gasto g
        join sucursal s on s.id = g.sucursal_id
       where g.deleted_at is null
         and g.metodo = ${METODO_GASTO_RUTA}
         and g.fecha <= ${hasta}::date
       group by 1, 2, 3
       order by 1, 3
    `.execute(this.db);
    return r.rows.map((f) => ({
      fecha: f.fecha,
      sucursalId: f.sucursal_id,
      sucursalCodigo: f.codigo,
      cantidad: Number(f.cantidad),
      montoCentavos: aCentavos(f.monto),
    }));
  }
}
