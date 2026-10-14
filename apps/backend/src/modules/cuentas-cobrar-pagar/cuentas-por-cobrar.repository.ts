import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DB_CONNECTION, type Database } from '../../database/database.tokens';
import { aCentavos } from '../sincronizacion/dinero';
import { buscarSucursalUsuario } from '../sucursales/buscar-sucursal-usuario';
import type { FilaNotaPorCobrar } from './reglas-cuentas-por-cobrar';

@Injectable()
export class CuentasPorCobrarRepository {
  constructor(@Inject(DB_CONNECTION) private readonly db: Database) {}

  buscarSucursalUsuario(usuarioId: string) {
    return buscarSucursalUsuario(this.db, usuarioId);
  }

  /** La fecha de hoy en Tijuana, del reloj de Postgres (nunca UTC). */
  async hoyEnTijuana(): Promise<string> {
    const r = await sql<{ hoy: string }>`
      select to_char((now() at time zone 'America/Tijuana')::date, 'YYYY-MM-DD') as hoy
    `.execute(this.db);
    return r.rows[0].hoy;
  }

  /**
   * Las notas vivas `pendiente`/`abonado` del alcance, con lo abonado en vivo
   * (los abonos de un pago borrado por T-34 tienen `deleted_at` y no cuentan) y
   * el vencimiento contra `hoy`. La sucursal es la del CLIENTE, como Cobranza.
   * `date + int` da `date` y `date - date` da dias enteros.
   */
  async notas(
    hoy: string,
    codigoSucursal: string | null,
  ): Promise<FilaNotaPorCobrar[]> {
    const filas = await sql<{
      id: string;
      cliente_id: string;
      cliente: string;
      sucursal_codigo: string;
      fecha: string;
      folio: string;
      num_nota: string | null;
      monto_total: string;
      abonado: string;
      status: string;
      vence: string | null;
      dias_atraso: number;
    }>`
      select vn.id, vn.cliente_id, c.nombre as cliente, s.codigo as sucursal_codigo,
             to_char(vn.fecha, 'YYYY-MM-DD') as fecha, vn.folio, vn.num_nota,
             vn.monto_total::text as monto_total,
             coalesce(a.abonado, 0)::text as abonado,
             vn.status,
             to_char(vn.fecha + c.plazo_credito_dias, 'YYYY-MM-DD') as vence,
             case when c.plazo_credito_dias is null then 0
                  else greatest(${hoy}::date - (vn.fecha + c.plazo_credito_dias), 0)
             end as dias_atraso
        from venta_nota vn
        join cliente c on c.id = vn.cliente_id
        join sucursal s on s.id = c.sucursal_id
        left join lateral (
          select sum(ca.monto) as abonado
            from cobranza_abono ca
           where ca.venta_nota_id = vn.id
             and ca.deleted_at is null
        ) a on true
       where vn.deleted_at is null
         and vn.status in ('pendiente', 'abonado')
         and (${codigoSucursal}::text is null or s.codigo = ${codigoSucursal}::text)
    `.execute(this.db);

    return filas.rows.map((f) => ({
      id: f.id,
      clienteId: f.cliente_id,
      cliente: f.cliente,
      sucursalCodigo: f.sucursal_codigo,
      fecha: f.fecha,
      folio: f.folio,
      numNota: f.num_nota,
      montoCentavos: aCentavos(f.monto_total),
      abonadoCentavos: aCentavos(f.abonado),
      status: f.status as 'pendiente' | 'abonado',
      vence: f.vence,
      diasAtraso: Number(f.dias_atraso),
    }));
  }
}
