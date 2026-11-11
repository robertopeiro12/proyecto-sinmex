import { Inject, Injectable } from '@nestjs/common';
import { sql, type RawBuilder, type Transaction } from 'kysely';
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
    return this.leer(
      sql`vn.contado_credito = 'credito'
         and vn.status in ('pendiente', 'abonado')
         and vn.cliente_id in (${ids})
         and vn.monto_total - coalesce(a.abonado, 0) > 0`,
      hoy,
      trx,
    );
  }

  /**
   * Esas notas (ventas vivas) con su saldo de hoy, **tengan o no saldo**: la
   * ventana de notas muestra tambien las asignadas que ya se pagaron. El saldo
   * nunca baja de 0 y una nota que no esta `pendiente`/`abonado` no debe nada. Por fecha y folio.
   */
  async notasPorId(
    ventaNotaIds: readonly string[],
    hoy: string,
    trx?: Transaction<DB>,
  ): Promise<NotaConSaldo[]> {
    if (ventaNotaIds.length === 0) return [];
    const ids = sql.join(ventaNotaIds.map((id) => sql`${id}::uuid`));
    return this.leer(sql`vn.id in (${ids})`, hoy, trx);
  }

  /**
   * La unica consulta de notas de ruta: el saldo (abonos vivos) y los dias de
   * atraso se calculan aqui para los dos caminos.
   */
  private async leer(
    filtro: RawBuilder<unknown>,
    hoy: string,
    trx?: Transaction<DB>,
  ): Promise<NotaConSaldo[]> {
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
             case when vn.status in ('pendiente', 'abonado')
                  then greatest(vn.monto_total - coalesce(a.abonado, 0), 0)
                  else 0
             end::text as saldo,
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
         and ${filtro}
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
