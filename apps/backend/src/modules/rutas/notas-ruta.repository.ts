import { Inject, Injectable } from '@nestjs/common';
import { sql, type Transaction } from 'kysely';
import { DB_CONNECTION, type Database } from '../../database/database.tokens';
import type { DB } from '../../database/schema';
import { aCentavos } from '../sincronizacion/dinero';

/** Una nota con saldo de un cliente de la ruta (spec §5.4). */
export interface NotaConSaldo {
  ventaNotaId: string;
  folio: string;
  clienteId: string;
  cliente: string;
  /** `AAAA-MM-DD`, la fecha de la venta. */
  fecha: string;
  saldoCentavos: number;
  diasAtraso: number;
}

/**
 * Las notas por cobrar de los clientes de una ruta del dia. Lo usan la lista
 * del dia (el conteo de "Notas pendientes por cobrar") y la ventana de notas
 * (Tarea 6), para que las dos cuenten lo mismo.
 */
@Injectable()
export class NotasRutaRepository {
  constructor(@Inject(DB_CONNECTION) private readonly db: Database) {}

  /**
   * Las notas con saldo de esos clientes: venta viva a CREDITO, `pendiente`/`abonado`,
   * con saldo > 0 descontando solo los abonos vivos (los de un pago borrado
   * por T-34 no cuentan), incluidas las del mismo dia. `diasAtraso` contra
   * `hoy` con el mismo calculo que Cuentas por Cobrar
   * (`cuentas-por-cobrar.repository.ts`). Por fecha y folio.
   */
  async notasConSaldo(
    clienteIds: readonly string[],
    hoy: string,
    trx?: Transaction<DB>,
  ): Promise<NotaConSaldo[]> {
    if (clienteIds.length === 0) return [];
    const ids = sql.join(clienteIds.map((id) => sql`${id}::uuid`));
    const filas = await sql<{
      id: string;
      folio: string;
      cliente_id: string;
      cliente: string;
      fecha: string;
      saldo: string;
      dias_atraso: number;
    }>`
      select vn.id, vn.folio, vn.cliente_id, c.nombre as cliente,
             to_char(vn.fecha, 'YYYY-MM-DD') as fecha,
             (vn.monto_total - coalesce(a.abonado, 0))::text as saldo,
             case when c.plazo_credito_dias is null then 0
                  else greatest(${hoy}::date - (vn.fecha + c.plazo_credito_dias), 0)
             end as dias_atraso
        from venta_nota vn
        join cliente c on c.id = vn.cliente_id
        left join lateral (
          select sum(ca.monto) as abonado
            from cobranza_abono ca
           where ca.venta_nota_id = vn.id
             and ca.deleted_at is null
        ) a on true
       where vn.deleted_at is null
         and vn.contado_credito = 'credito'
         and vn.status in ('pendiente', 'abonado')
         and vn.cliente_id in (${ids})
         and vn.monto_total - coalesce(a.abonado, 0) > 0
       order by vn.fecha, vn.folio
    `.execute(trx ?? this.db);

    return filas.rows.map((f) => ({
      ventaNotaId: f.id,
      folio: f.folio,
      clienteId: f.cliente_id,
      cliente: f.cliente,
      fecha: f.fecha,
      saldoCentavos: aCentavos(f.saldo),
      diasAtraso: Number(f.dias_atraso),
    }));
  }
}
