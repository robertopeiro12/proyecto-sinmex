import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DB_CONNECTION, type Database } from '../../database/database.tokens';
import { aCentavos } from '../sincronizacion/dinero';
import { buscarSucursalUsuario } from '../sucursales/buscar-sucursal-usuario';
import type { FilaVenta, StatusVenta } from './reglas-reporte-ventas';

export type FiltroRepartidor =
  { tipo: 'todos' } | { tipo: 'oficina' } | { tipo: 'vendedor'; id: string };

export interface FiltroVentas {
  desde: string;
  hasta: string;
  /** `null` = todas las sucursales (usuario General sin filtro). */
  codigoSucursal: string | null;
  repartidor: FiltroRepartidor;
}

@Injectable()
export class ReporteVentasRepository {
  constructor(@Inject(DB_CONNECTION) private readonly db: Database) {}

  buscarSucursalUsuario(usuarioId: string) {
    return buscarSucursalUsuario(this.db, usuarioId);
  }

  /**
   * Las ventas vivas del rango, cualquier status. Piezas de lineas VIVAS (una
   * venta editada puede tener lineas borradas, T-17). La sucursal es la de la
   * VENTA, como la pantalla Ventas.
   */
  async ventas(f: FiltroVentas): Promise<FilaVenta[]> {
    const condiciones = [
      sql`vn.deleted_at is null`,
      sql`vn.fecha between ${f.desde}::date and ${f.hasta}::date`,
    ];
    if (f.codigoSucursal !== null)
      condiciones.push(sql`s.codigo = ${f.codigoSucursal}`);
    if (f.repartidor.tipo === 'oficina')
      condiciones.push(sql`vn.vendedor_id is null`);
    if (f.repartidor.tipo === 'vendedor')
      condiciones.push(sql`vn.vendedor_id = ${f.repartidor.id}::uuid`);

    const filas = await sql<{
      id: string;
      fecha: string;
      folio: string;
      cliente: string;
      num_nota: string | null;
      vendedor_id: string | null;
      repartidor: string | null;
      status: string;
      factura: string;
      semana: number;
      cantidad: number;
      promocion: number;
      monto_total: string;
    }>`
      select vn.id, to_char(vn.fecha, 'YYYY-MM-DD') as fecha, vn.folio,
             c.nombre as cliente, vn.num_nota, vn.vendedor_id,
             v.nombre as repartidor, vn.status,
             case vn.factura
               when 'facturada' then f.numero
               when 'pendiente' then 'Pendiente'
               else 'N/A'
             end as factura,
             vn.semana,
             coalesce(d.cantidad, 0)::int as cantidad,
             coalesce(d.promocion, 0)::int as promocion,
             vn.monto_total::text as monto_total
        from venta_nota vn
        join cliente c on c.id = vn.cliente_id
        join sucursal s on s.id = vn.sucursal_id
        left join vendedor v on v.id = vn.vendedor_id
        left join factura f on f.id = vn.factura_id
        left join lateral (
          select sum(dd.cantidad) as cantidad,
                 sum(dd.cantidad_promocion) as promocion
            from venta_nota_detalle dd
           where dd.venta_nota_id = vn.id
             and dd.deleted_at is null
        ) d on true
       where ${sql.join(condiciones, sql` and `)}
    `.execute(this.db);

    return filas.rows.map((r) => ({
      id: r.id,
      fecha: r.fecha,
      folio: r.folio,
      cliente: r.cliente,
      numNota: r.num_nota,
      vendedorId: r.vendedor_id,
      repartidor: r.repartidor,
      status: r.status as StatusVenta,
      factura: r.factura,
      semana: Number(r.semana),
      cantidad: Number(r.cantidad),
      promocion: Number(r.promocion),
      montoCentavos: aCentavos(r.monto_total),
    }));
  }
}
