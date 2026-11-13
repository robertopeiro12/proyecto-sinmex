import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DB_CONNECTION, type Database } from '../../database/database.tokens';
import { aCentavos } from '../sincronizacion/dinero';
import { buscarSucursalUsuario } from '../sucursales/buscar-sucursal-usuario';
import {
  contarNotasNoEntregadas,
  type CobranzaOficinaDia,
  type FilaVendedorDia,
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
    f: FiltroFlujoDiario & {
      vendedorId: string | null;
      /**
       * Solo el Dashboard: la ruta diaria no basta para listar a un vendedor
       * inactivo o dado de baja (si tiene otro movimiento, si sale). El Flujo
       * diario es historia y los conserva.
       */
      soloVigentesEnRuta?: boolean;
    },
  ): Promise<FilaVendedorDia[]> {
    const condiciones = [sql`true`];
    if (f.codigoSucursal !== null)
      condiciones.push(sql`s.codigo = ${f.codigoSucursal}`);
    if (f.vendedorId !== null)
      condiciones.push(sql`v.id = ${f.vendedorId}::uuid`);
    const rutaVigente = f.soloVigentesEnRuta
      ? sql`and vr.activo and vr.deleted_at is null`
      : sql``;

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
      ruta_nombre: string | null;
      vehiculo_asignado: string | null;
      notas_por_revisar: number;
      notas_revisadas: number;
      notas_no_entregadas: number;
    }>`
      with dias as (
        select ru.vendedor_id, ru.fecha from ruta ru
          join vendedor vr on vr.id = ru.vendedor_id
         where ru.tipo = 'diaria' and ru.deleted_at is null
           and ru.fecha between ${f.desde}::date and ${f.hasta}::date
           ${rutaVigente}
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
                                 and vi.cliente_id = r.cliente_id)
                   -- Un comentario "no cobre" tambien atiende al cliente (decision
                   -- 17); no se filtra la nota borrada: el comentario se acepta
                   -- aunque la venta se borre despues (decision 13).
                   or exists (select 1 from nota_no_cobrada c
                               join venta_nota vn2 on vn2.id = c.venta_nota_id
                               where c.deleted_at is null
                                 and c.vendedor_id = d.vendedor_id
                                 and c.fecha = d.fecha
                                 and vn2.cliente_id = r.cliente_id))
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
             j.vehiculo as vehiculo,
             rd.nombre_ruta as ruta_nombre,
             va.nombre as vehiculo_asignado,
             pn.por_revisar as notas_por_revisar,
             pn.revisadas as notas_revisadas,
             pn.no_entregadas as notas_no_entregadas
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
        left join ruta_dia rd
          on rd.vendedor_id = d.vendedor_id and rd.fecha = d.fecha
         and rd.deleted_at is null
        left join vehiculo va on va.id = rd.vehiculo_id
        -- Revision de papel de la tarde (Ruta Diaria parte 2), lo mismo que la
        -- ventana (reglas-detalle.ts): sus asignadas de ese dia y sus ventas a
        -- credito de ese dia (una que tambien es asignada cuenta una vez, como
        -- asignada). Se piden las que se cobran (pendiente/abonado con
        -- saldo) y las ya revisadas aunque hoy esten pagadas. Una asignada con
        -- saldo que no se cobra (cuenta perdida) no cuenta ni revisada.
        left join lateral (
          select count(*) filter (
                   where n.entregada is not null
                      or (n.saldo > 0 and n.status in ('pendiente', 'abonado'))
                 )::int as por_revisar,
                 count(*) filter (where n.entregada is not null)::int as revisadas,
                 count(*) filter (where n.entregada = false)::int as no_entregadas
            from (
              select true as es_asignada, na.papel_entregado as entregada,
                     vn.status,
                     vn.monto_total - coalesce((
                       select sum(a.monto) from cobranza_abono a
                        where a.venta_nota_id = vn.id and a.deleted_at is null
                     ), 0) as saldo
                from nota_asignada na
                join venta_nota vn on vn.id = na.venta_nota_id
               where na.deleted_at is null and vn.deleted_at is null
                 and na.vendedor_id = d.vendedor_id and na.fecha = d.fecha
              union all
              select false, vn.papel_entregado, vn.status,
                     vn.monto_total - coalesce((
                       select sum(a.monto) from cobranza_abono a
                        where a.venta_nota_id = vn.id and a.deleted_at is null
                     ), 0)
                from venta_nota vn
               where vn.deleted_at is null and vn.contado_credito = 'credito'
                 and vn.vendedor_id = d.vendedor_id and vn.fecha = d.fecha
                 and not exists (
                   select 1 from nota_asignada na
                    where na.deleted_at is null and na.venta_nota_id = vn.id
                      and na.vendedor_id = d.vendedor_id and na.fecha = d.fecha)
            ) n
           -- La asignada con saldo que no se cobra no sale en la ventana.
           where not (n.es_asignada and n.saldo > 0
                      and n.status not in ('pendiente', 'abonado'))
        ) pn on true
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
      rutaNombre: x.ruta_nombre,
      vehiculoAsignado: x.vehiculo_asignado,
      notasNoEntregadas: contarNotasNoEntregadas({
        porRevisar: Number(x.notas_por_revisar),
        revisadas: Number(x.notas_revisadas),
        noEntregadas: Number(x.notas_no_entregadas),
      }),
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
