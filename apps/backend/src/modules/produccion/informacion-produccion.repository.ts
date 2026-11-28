import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DB_CONNECTION, type Database } from '../../database/database.tokens';

/** Lo producido y comprado de una presentacion en el rango. */
export interface FilaInformacion {
  presentacionId: string;
  productoId: string;
  producto: string;
  volumen: string;
  produccion: number;
  compras: number;
}

/** Una captura (operacion) que tocó lo pedido. */
export interface FilaDetalleInformacion {
  /** `AAAA-MM-DD`. */
  fecha: string;
  /** `hh:mm` de Tijuana, de `created_at`. */
  hora: string;
  /** Codigo de la sucursal. */
  sucursal: string;
  origen: 'produccion' | 'compra';
  capturo: string;
  piezas: number;
  comentario: string | null;
}

const idsComoArreglo = (ids: readonly string[]) =>
  sql`array[${sql.join([...ids])}]::uuid[]`;

/**
 * Sucursales del ambito: `null` = Todas, sin filtrar, para que cuenten tambien
 * las entradas de una sucursal dada de baja despues (es historia).
 */
const deSucursales = (sucursalIds: readonly string[] | null) =>
  sucursalIds === null
    ? sql`true`
    : sql`o.sucursal_id = any(${idsComoArreglo(sucursalIds)})`;

/**
 * SQL de Informacion de Produccion: solo las `entrada` vivas del Registro de
 * Operacion (nunca `envio` ni otro tipo), en las sucursales del ambito (con
 * Todas, tambien las dadas de baja) y el rango (ambos dias incluidos). Una consulta agrupada, sin N+1.
 */
@Injectable()
export class InformacionProduccionRepository {
  constructor(@Inject(DB_CONNECTION) private readonly db: Database) {}

  /** Produccion y compras por presentacion (viva o no: es historia). */
  async totales(
    sucursalIds: readonly string[] | null,
    desde: string,
    hasta: string,
  ): Promise<FilaInformacion[]> {
    if (sucursalIds?.length === 0) return [];
    const r = await sql<FilaInformacion>`
      select pr.id as "presentacionId", p.id as "productoId",
             p.nombre as producto, pr.volumen as volumen,
             coalesce(sum(case when o.origen = 'produccion' then l.piezas else 0 end), 0)::int as produccion,
             coalesce(sum(case when o.origen = 'compra' then l.piezas else 0 end), 0)::int as compras
        from operacion_almacen o
        join operacion_almacen_linea l on l.operacion_id = o.id
        join presentacion pr on pr.id = l.presentacion_id
        join producto p on p.id = pr.producto_id
       where o.deleted_at is null
         and o.tipo = 'entrada'
         and ${deSucursales(sucursalIds)}
         and o.fecha between ${desde}::date and ${hasta}::date
       group by pr.id, p.id, p.nombre, pr.volumen
    `.execute(this.db);
    return r.rows;
  }

  /**
   * Las capturas que tocaron las presentaciones pedidas, una fila por
   * operacion (con un producto, suma sus presentaciones), de la mas vieja a la
   * mas nueva.
   */
  async detalle(
    sucursalIds: readonly string[] | null,
    presentacionIds: readonly string[],
    desde: string,
    hasta: string,
  ): Promise<FilaDetalleInformacion[]> {
    if (sucursalIds?.length === 0 || presentacionIds.length === 0) return [];
    const r = await sql<FilaDetalleInformacion>`
      select to_char(o.fecha, 'YYYY-MM-DD') as fecha,
             to_char(o.created_at at time zone 'America/Tijuana', 'HH24:MI') as hora,
             s.codigo as sucursal,
             o.origen as origen,
             u.nombre as capturo,
             sum(l.piezas)::int as piezas,
             o.comentario as comentario
        from operacion_almacen o
        join operacion_almacen_linea l on l.operacion_id = o.id
        join sucursal s on s.id = o.sucursal_id
        join usuario u on u.id = o.capturo_usuario_id
       where o.deleted_at is null
         and o.tipo = 'entrada'
         and ${deSucursales(sucursalIds)}
         and o.fecha between ${desde}::date and ${hasta}::date
         and l.presentacion_id = any(${idsComoArreglo(presentacionIds)})
       group by o.id, s.codigo, u.nombre
       order by o.fecha, o.created_at, o.id
    `.execute(this.db);
    return r.rows;
  }
}
