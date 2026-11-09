import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DB_CONNECTION, type Database } from '../../database/database.tokens';
import { aCentavos } from '../sincronizacion/dinero';
import { buscarSucursalUsuario } from '../sucursales/buscar-sucursal-usuario';
import type {
  CobranzaOficinaDia,
  FilaVendedorDia,
} from './reglas-flujo-diario';

export interface FiltroFlujoDiario {
  desde: string;
  hasta: string;
  /** `null` = todas las sucursales (usuario General sin filtro). */
  codigoSucursal: string | null;
}

@Injectable()
export class FlujoDiarioRepository {
  constructor(@Inject(DB_CONNECTION) private readonly db: Database) {}

  buscarSucursalUsuario(usuarioId: string) {
    return buscarSucursalUsuario(this.db, usuarioId);
  }

  /**
   * Un renglon por vendedor y dia. Un (vendedor, dia) existe si tiene ruta
   * diaria viva o cualquier movimiento vivo ese dia (venta, cobro, visita,
   * gasto, jornada). La sucursal es la del VENDEDOR. Todo se lee de las tablas
   * (no se copia): lo borrado o editado deja de contar solo (T-17, T-34).
   */
  async filas(
    f: FiltroFlujoDiario & { vendedorId: string | null },
  ): Promise<FilaVendedorDia[]> {
    const condiciones = [sql`true`];
    if (f.codigoSucursal !== null)
      condiciones.push(sql`s.codigo = ${f.codigoSucursal}`);
    if (f.vendedorId !== null)
      condiciones.push(sql`v.id = ${f.vendedorId}::uuid`);

    const r = await sql<{
      fecha: string;
      vendedor_id: string;
      vendedor: string;
      codigo: string;
      clientes_en_ruta: number;
      atendidos_en_ruta: number;
      piezas: number;
      monto: string;
      contado: string;
      anteriores: string;
      a_favor: string;
      gasto: string;
      jornada_cerrada: boolean;
      vehiculo: string | null;
    }>`
      with dias as (
        select vendedor_id, fecha from ruta
         where tipo = 'diaria' and deleted_at is null
           and fecha between ${f.desde}::date and ${f.hasta}::date
        union
        select vendedor_id, fecha from venta_nota
         where deleted_at is null and vendedor_id is not null
           and fecha between ${f.desde}::date and ${f.hasta}::date
        union
        select vendedor_id, fecha_pago from cobro
         where deleted_at is null and origen = 'cobro' and vendedor_id is not null
           and fecha_pago between ${f.desde}::date and ${f.hasta}::date
        union
        select vendedor_id, fecha from visita
         where fecha between ${f.desde}::date and ${f.hasta}::date
        union
        select vendedor_id, fecha from gasto
         where deleted_at is null and vendedor_id is not null
           and fecha between ${f.desde}::date and ${f.hasta}::date
        union
        select vendedor_id, fecha from jornada
         where deleted_at is null
           and fecha between ${f.desde}::date and ${f.hasta}::date
      )
      select to_char(d.fecha, 'YYYY-MM-DD') as fecha,
             v.id as vendedor_id, v.nombre as vendedor, s.codigo,
             (select count(distinct r.cliente_id)::int from ruta r
               where r.tipo = 'diaria' and r.deleted_at is null
                 and r.vendedor_id = d.vendedor_id and r.fecha = d.fecha
             ) as clientes_en_ruta,
             (select count(distinct r.cliente_id)::int from ruta r
               where r.tipo = 'diaria' and r.deleted_at is null
                 and r.vendedor_id = d.vendedor_id and r.fecha = d.fecha
                 and (exists (select 1 from venta_nota vn
                               where vn.deleted_at is null
                                 and vn.vendedor_id = d.vendedor_id
                                 and vn.fecha = d.fecha
                                 and vn.cliente_id = r.cliente_id)
                   or exists (select 1 from visita vi
                               where vi.vendedor_id = d.vendedor_id
                                 and vi.fecha = d.fecha
                                 and vi.cliente_id = r.cliente_id))
             ) as atendidos_en_ruta,
             (select coalesce(sum(dd.cantidad), 0)::int
                from venta_nota vn
                join venta_nota_detalle dd on dd.venta_nota_id = vn.id
               where vn.deleted_at is null and dd.deleted_at is null
                 and vn.vendedor_id = d.vendedor_id and vn.fecha = d.fecha
             ) as piezas,
             (select coalesce(sum(vn.monto_total), 0)::text from venta_nota vn
               where vn.deleted_at is null
                 and vn.vendedor_id = d.vendedor_id and vn.fecha = d.fecha
             ) as monto,
             (select coalesce(sum(a.monto), 0)::text
                from cobranza_abono a
                join venta_nota vn on vn.id = a.venta_nota_id
               where a.deleted_at is null and vn.deleted_at is null
                 and a.origen = 'venta_contado'
                 and vn.vendedor_id = d.vendedor_id and a.fecha_pago = d.fecha
             ) as contado,
             (select coalesce(sum(a.monto), 0)::text
                from cobranza_abono a
                join cobro c on c.id = a.cobro_id
                join venta_nota vn on vn.id = a.venta_nota_id
               where a.deleted_at is null and c.deleted_at is null
                 and vn.deleted_at is null
                 and a.origen = 'cobro' and c.origen = 'cobro'
                 and c.vendedor_id = d.vendedor_id and a.fecha_pago = d.fecha
             ) as anteriores,
             (select coalesce(sum(greatest(c.monto - coalesce((
                        select sum(a.monto) from cobranza_abono a
                         where a.cobro_id = c.id and a.deleted_at is null
                      ), 0), 0)), 0)::text
                from cobro c
               where c.deleted_at is null and c.origen = 'cobro'
                 and c.vendedor_id = d.vendedor_id and c.fecha_pago = d.fecha
             ) as a_favor,
             (select coalesce(sum(g.monto), 0)::text from gasto g
               where g.deleted_at is null
                 and g.vendedor_id = d.vendedor_id and g.fecha = d.fecha
             ) as gasto,
             (j.id is not null) as jornada_cerrada,
             j.vehiculo as vehiculo
        from dias d
        join vendedor v on v.id = d.vendedor_id
        join sucursal s on s.id = v.sucursal_id
        left join lateral (
          select jo.id, ve.nombre as vehiculo
            from jornada jo
            join vehiculo ve on ve.id = jo.vehiculo_id
           where jo.deleted_at is null
             and jo.vendedor_id = d.vendedor_id and jo.fecha = d.fecha
           order by jo.cerrada_en desc, jo.id
           limit 1
        ) j on true
       where ${sql.join(condiciones, sql` and `)}
    `.execute(this.db);

    return r.rows.map((x) => ({
      fecha: x.fecha,
      vendedorId: x.vendedor_id,
      vendedor: x.vendedor,
      sucursalCodigo: x.codigo,
      clientesEnRuta: Number(x.clientes_en_ruta),
      atendidosEnRuta: Number(x.atendidos_en_ruta),
      piezas: Number(x.piezas),
      montoCentavos: aCentavos(x.monto),
      contadoCentavos: aCentavos(x.contado),
      anterioresCentavos: aCentavos(x.anteriores),
      aFavorCentavos: aCentavos(x.a_favor),
      gastoCentavos: aCentavos(x.gasto),
      jornadaCerrada: x.jornada_cerrada,
      vehiculo: x.vehiculo,
    }));
  }

  /**
   * Cobranza de la oficina: `cobro` vivo de origen 'cobro' sin vendedor, por
   * dia de pago y sucursal del CLIENTE. Los abonos de contado de una venta de
   * mostrador no entran aqui.
   */
  async oficina(f: FiltroFlujoDiario): Promise<CobranzaOficinaDia[]> {
    const condiciones = [
      sql`c.deleted_at is null`,
      sql`c.origen = 'cobro'`,
      sql`c.vendedor_id is null`,
      sql`c.fecha_pago between ${f.desde}::date and ${f.hasta}::date`,
    ];
    if (f.codigoSucursal !== null)
      condiciones.push(sql`s.codigo = ${f.codigoSucursal}`);

    const r = await sql<{ fecha: string; codigo: string; monto: string }>`
      select to_char(c.fecha_pago, 'YYYY-MM-DD') as fecha, s.codigo,
             sum(c.monto)::text as monto
        from cobro c
        join cliente cl on cl.id = c.cliente_id
        join sucursal s on s.id = cl.sucursal_id
       where ${sql.join(condiciones, sql` and `)}
       group by 1, 2
    `.execute(this.db);
    return r.rows.map((x) => ({
      fecha: x.fecha,
      sucursalCodigo: x.codigo,
      montoCentavos: aCentavos(x.monto),
    }));
  }
}
