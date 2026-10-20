import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DB_CONNECTION, type Database } from '../../database/database.tokens';
import { aCentavos } from '../sincronizacion/dinero';
import type { FilaCobroDia, FilaGastoTipo, FilaVentaDia } from './reglas-flujo';

export interface ComentarioGasto {
  fecha: string;
  campo: string;
  vendedor: string | null;
  montoCentavos: number;
  comentario: string;
}

export interface ComentarioIngreso {
  fecha: string;
  folio: string;
  cliente: string;
  comentario: string;
}

/**
 * T-32 (spec §3): lecturas del Flujo de Efectivo. Solo lee de Ventas, Cobranza y
 * Compras y Egresos; `codigo` null = todas las sucursales.
 */
@Injectable()
export class FlujoEfectivoRepository {
  constructor(@Inject(DB_CONNECTION) private readonly db: Database) {}

  /** Ventas vivas del rango por dia (sucursal de la venta, cualquier status). */
  async ventasPorDia(
    desde: string,
    hasta: string,
    codigo: string | null,
  ): Promise<FilaVentaDia[]> {
    const filtro = codigo === null ? sql`` : sql`and s.codigo = ${codigo}`;
    const r = await sql<{ fecha: string; monto: string }>`
      select to_char(vn.fecha, 'YYYY-MM-DD') as fecha, sum(vn.monto_total)::text as monto
        from venta_nota vn
        join sucursal s on s.id = vn.sucursal_id
       where vn.deleted_at is null
         and vn.fecha between ${desde}::date and ${hasta}::date
         ${filtro}
       group by 1
    `.execute(this.db);
    return r.rows.map((f) => ({
      fecha: f.fecha,
      ventasCentavos: aCentavos(f.monto),
    }));
  }

  /**
   * Cobradas por dia y tipo: `cobro` (sucursal del cliente) + contado (sucursal
   * de la venta). Repartidor = tiene vendedor; nunca saldo a favor.
   */
  async cobradasPorDia(
    desde: string,
    hasta: string,
    codigo: string | null,
  ): Promise<FilaCobroDia[]> {
    const filtro = codigo === null ? sql`` : sql`and s.codigo = ${codigo}`;
    const r = await sql<{
      fecha: string;
      repartidor: boolean;
      monto: string;
    }>`
      select fecha, repartidor, sum(monto)::text as monto from (
        select to_char(c.fecha_pago, 'YYYY-MM-DD') as fecha, (c.vendedor_id is not null) as repartidor, c.monto
          from cobro c
          join cliente cl on cl.id = c.cliente_id
          join sucursal s on s.id = cl.sucursal_id
         where c.deleted_at is null and c.origen = 'cobro'
           and c.metodo_pago in ('efectivo', 'transferencia', 'cheque')
           and c.fecha_pago between ${desde}::date and ${hasta}::date
           ${filtro}
        union all
        select to_char(a.fecha_pago, 'YYYY-MM-DD'), (vn.vendedor_id is not null), a.monto
          from cobranza_abono a
          join venta_nota vn on vn.id = a.venta_nota_id
          join sucursal s on s.id = vn.sucursal_id
         where a.deleted_at is null and vn.deleted_at is null and a.origen = 'venta_contado'
           and a.metodo_pago in ('efectivo', 'transferencia', 'cheque')
           and a.fecha_pago between ${desde}::date and ${hasta}::date
           ${filtro}
      ) t
      group by fecha, repartidor
    `.execute(this.db);
    return r.rows.map((f) => ({
      fecha: f.fecha,
      repartidor: f.repartidor,
      montoCentavos: aCentavos(f.monto),
    }));
  }

  /** Comentarios de las ventas vivas del rango. */
  async comentariosDeVentas(
    desde: string,
    hasta: string,
    codigo: string | null,
  ): Promise<ComentarioIngreso[]> {
    const filtro = codigo === null ? sql`` : sql`and s.codigo = ${codigo}`;
    const r = await sql<ComentarioIngreso>`
      select to_char(vn.fecha, 'YYYY-MM-DD') as fecha, vn.folio, cl.nombre as cliente,
             btrim(vn.comentarios) as comentario
        from venta_nota vn
        join cliente cl on cl.id = vn.cliente_id
        join sucursal s on s.id = vn.sucursal_id
       where vn.deleted_at is null and btrim(coalesce(vn.comentarios, '')) <> ''
         and vn.fecha between ${desde}::date and ${hasta}::date
         ${filtro}
       order by vn.fecha, vn.folio
    `.execute(this.db);
    return r.rows;
  }

  /**
   * Gastos vivos del rango por tipo (T-30/T-31), por su `fecha` y la sucursal
   * del gasto. TODOS los metodos: el flujo cuenta todo egreso, no solo el que
   * salio del efectivo de la cobranza (eso es lo que filtra Tesoreria).
   */
  async gastosPorTipo(
    desde: string,
    hasta: string,
    codigo: string | null,
  ): Promise<FilaGastoTipo[]> {
    const filtro = codigo === null ? sql`` : sql`and s.codigo = ${codigo}`;
    const r = await sql<{ tipo: FilaGastoTipo['tipo']; monto: string }>`
      select g.tipo, sum(g.monto)::text as monto
        from gasto g
        join sucursal s on s.id = g.sucursal_id
       where g.deleted_at is null
         and g.fecha between ${desde}::date and ${hasta}::date
         ${filtro}
       group by g.tipo
    `.execute(this.db);
    return r.rows.map((f) => ({
      tipo: f.tipo,
      montoCentavos: aCentavos(f.monto),
    }));
  }

  /** Comentarios de los gastos vivos del rango. */
  async comentariosDeGastos(
    desde: string,
    hasta: string,
    codigo: string | null,
  ): Promise<ComentarioGasto[]> {
    const filtro = codigo === null ? sql`` : sql`and s.codigo = ${codigo}`;
    const r = await sql<{
      fecha: string;
      campo: string;
      vendedor: string | null;
      monto: string;
      comentario: string;
    }>`
      select to_char(g.fecha, 'YYYY-MM-DD') as fecha, g.campo_nombre as campo,
             v.nombre as vendedor, g.monto::text as monto,
             btrim(g.comentario) as comentario
        from gasto g
        join sucursal s on s.id = g.sucursal_id
        left join vendedor v on v.id = g.vendedor_id
       where g.deleted_at is null and btrim(coalesce(g.comentario, '')) <> ''
         and g.fecha between ${desde}::date and ${hasta}::date
         ${filtro}
       order by g.fecha, g.registrado_en, g.id
    `.execute(this.db);
    return r.rows.map((f) => ({
      fecha: f.fecha,
      campo: f.campo,
      vendedor: f.vendedor,
      montoCentavos: aCentavos(f.monto),
      comentario: f.comentario,
    }));
  }
}
