import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DB_CONNECTION, type Database } from '../../database/database.tokens';
import type { MovimientosRecargas } from './reglas-inventario-pt-recargas';

/** Lo que se movio hoy de una presentacion en una sucursal. */
export interface MovimientosRecargasSucursal extends MovimientosRecargas {
  sucursalId: string;
  presentacionId: string;
}

/** Una fila de "a quien": el vendedor, su numero de carga y las piezas aceptadas. */
export interface FilaDetalleRecargas {
  quien: string;
  /** `carga.numero`. */
  carga: number;
  piezas: number;
}

const idsComoArreglo = (ids: readonly string[]) =>
  sql`array[${sql.join([...ids])}]::uuid[]`;

/**
 * Un renglon de carga que resta: solo cuando el vendedor ya lo acepto (tio,
 * 2026-11-25; una pendiente no resta). `null` = una carga aceptada antes de la
 * respuesta por renglon, como en el Corte.
 */
const RENGLON_QUE_CUENTA = sql`(c.estado = 'aceptada' and coalesce(cd.aceptada, true))`;

/**
 * SQL del Inventario de PT con Recargas: solo cargas aceptadas, envios y
 * entradas de UN dia (nada de merma, consumo, descuentos, ventas, app, Procesos
 * ni cortes: eso es PT con Ventas, el inventario real). Todo vivo; una consulta
 * agrupada por sucursal y presentacion.
 */
@Injectable()
export class InventarioPtRecargasRepository {
  constructor(@Inject(DB_CONNECTION) private readonly db: Database) {}

  /** La hora de la consulta en Tijuana, `hh:mm`. */
  async horaEnTijuana(): Promise<string> {
    const r = await sql<{ hora: string }>`
      select to_char(now() at time zone 'America/Tijuana', 'HH24:MI') as hora
    `.execute(this.db);
    return r.rows[0].hora;
  }

  /**
   * Recargas aceptadas (sucursal de la carga, vendedor vivo o dado de baja),
   * envios que salen y entradas + envios recibidos, por sucursal y
   * presentacion, de `fecha`.
   */
  async movimientos(
    sucursalIds: readonly string[],
    fecha: string,
  ): Promise<MovimientosRecargasSucursal[]> {
    if (sucursalIds.length === 0) return [];
    const suc = idsComoArreglo(sucursalIds);
    const r = await sql<MovimientosRecargasSucursal>`
      with mov as (
        select c.sucursal_id, cd.presentacion_id,
               cd.piezas as recargas, 0 as envios, 0 as entradas
          from carga c
          join carga_detalle cd on cd.carga_id = c.id
         where c.deleted_at is null
           and c.sucursal_id = any(${suc})
           and c.fecha = ${fecha}::date
           and ${RENGLON_QUE_CUENTA}
        union all
        select oa.sucursal_id, l.presentacion_id,
               0,
               case when oa.tipo = 'envio' then l.piezas else 0 end,
               case when oa.tipo = 'entrada' then l.piezas else 0 end
          from operacion_almacen oa
          join operacion_almacen_linea l on l.operacion_id = oa.id
         where oa.deleted_at is null
           and oa.tipo in ('envio', 'entrada')
           and oa.sucursal_id = any(${suc})
           and oa.fecha = ${fecha}::date
        union all
        -- Envios recibidos: entran como Entrada en el destino.
        select oa.sucursal_destino_id, l.presentacion_id,
               0, 0, l.piezas
          from operacion_almacen oa
          join operacion_almacen_linea l on l.operacion_id = oa.id
         where oa.deleted_at is null
           and oa.tipo = 'envio'
           and oa.sucursal_destino_id = any(${suc})
           and oa.fecha = ${fecha}::date
      )
      select sucursal_id as "sucursalId",
             presentacion_id as "presentacionId",
             sum(recargas)::int as recargas,
             sum(envios)::int as envios,
             sum(entradas)::int as entradas
        from mov
       group by sucursal_id, presentacion_id
    `.execute(this.db);
    return r.rows;
  }

  /**
   * "A quien" de las recargas: por carga, el vendedor, su numero y las piezas
   * aceptadas de esas presentaciones (sumadas por carga).
   */
  async detalleRecargas(
    sucursalIds: readonly string[],
    presentacionIds: readonly string[],
    fecha: string,
  ): Promise<FilaDetalleRecargas[]> {
    if (sucursalIds.length === 0 || presentacionIds.length === 0) return [];
    const r = await sql<FilaDetalleRecargas>`
      select v.nombre as quien,
             c.numero as carga,
             sum(cd.piezas)::int as piezas
        from carga c
        join carga_detalle cd on cd.carga_id = c.id
        join vendedor v on v.id = c.vendedor_id
       where c.deleted_at is null
         and c.sucursal_id = any(${idsComoArreglo(sucursalIds)})
         and cd.presentacion_id = any(${idsComoArreglo(presentacionIds)})
         and c.fecha = ${fecha}::date
         and ${RENGLON_QUE_CUENTA}
       group by c.id, v.nombre, c.numero
       order by v.nombre, c.numero, c.id
    `.execute(this.db);
    return r.rows;
  }
}
