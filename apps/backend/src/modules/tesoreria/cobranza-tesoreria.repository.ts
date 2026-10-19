import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DB_CONNECTION, type Database } from '../../database/database.tokens';
import { aCentavos } from '../sincronizacion/dinero';
import type { CobranzaDia, MetodoCobranza } from './reglas-destino';

/**
 * T-29 (spec §3.2): la cobranza que entra a Tesoreria, LEIDA (no copiada) de las
 * tablas de Ventas y Cobranza, agrupada por dia de pago, sucursal y metodo.
 *   - `cobro` vivo de origen 'cobro' (tablet o portal), sucursal del CLIENTE.
 *   - abono vivo de origen 'venta_contado' de una venta viva, sucursal de la VENTA.
 * Nunca el saldo a favor aplicado (no es dinero nuevo). Un cobro borrado con
 * peticion (T-34) o una venta eliminada/editada (T-17) dejan de contar solos.
 */
@Injectable()
export class CobranzaTesoreriaRepository {
  constructor(@Inject(DB_CONNECTION) private readonly db: Database) {}

  async porDia(hasta: string): Promise<CobranzaDia[]> {
    const r = await sql<{
      fecha: string;
      sucursal_id: string;
      codigo: string;
      metodo: string;
      cantidad: number;
      monto: string;
    }>`
      select fecha, sucursal_id, codigo, metodo, sum(cantidad)::int as cantidad, sum(monto)::text as monto
      from (
        select to_char(c.fecha_pago, 'YYYY-MM-DD') as fecha, cl.sucursal_id, s.codigo, c.metodo_pago as metodo,
               count(*) as cantidad, sum(c.monto) as monto
          from cobro c
          join cliente cl on cl.id = c.cliente_id
          join sucursal s on s.id = cl.sucursal_id
         where c.deleted_at is null
           and c.origen = 'cobro'
           and c.metodo_pago in ('efectivo', 'transferencia', 'cheque')
           and c.fecha_pago <= ${hasta}::date
         group by 1, 2, 3, 4
        union all
        select to_char(a.fecha_pago, 'YYYY-MM-DD'), vn.sucursal_id, s.codigo, a.metodo_pago,
               count(*), sum(a.monto)
          from cobranza_abono a
          join venta_nota vn on vn.id = a.venta_nota_id
          join sucursal s on s.id = vn.sucursal_id
         where a.deleted_at is null
           and vn.deleted_at is null
           and a.origen = 'venta_contado'
           and a.metodo_pago in ('efectivo', 'transferencia', 'cheque')
           and a.fecha_pago <= ${hasta}::date
         group by 1, 2, 3, 4
      ) t
      group by fecha, sucursal_id, codigo, metodo
      order by fecha, codigo, metodo
    `.execute(this.db);
    return r.rows.map((f) => ({
      fecha: f.fecha,
      sucursalId: f.sucursal_id,
      sucursalCodigo: f.codigo,
      metodo: f.metodo as MetodoCobranza,
      cantidad: Number(f.cantidad),
      montoCentavos: aCentavos(f.monto),
    }));
  }
}
