import { Inject, Injectable } from '@nestjs/common';
import { sql, type Transaction } from 'kysely';
import { DB_CONNECTION, type Database } from '../../database/database.tokens';
import type { DB } from '../../database/schema';
import { buscarSucursalUsuario as buscarSucursalUsuarioCompartido } from '../sucursales/buscar-sucursal-usuario';

/** El cliente de la venta y la sucursal que la venta hereda (§4.2, paso 1). */
export interface ClienteDeVenta {
  id: string;
  sucursalId: string;
  sucursalCodigo: string;
}

/** El vendedor de la venta, ya bloqueado, con la casilla de su sucursal. */
export interface VendedorConInventario {
  id: string;
  nombre: string;
  /** `sucursal.control_inventario` de la sucursal del vendedor (T-27). */
  controlInventario: boolean;
}

/** Un vendedor que se puede elegir como repartidor (§4.1). */
export interface Repartidor {
  id: string;
  nombre: string;
}

/**
 * Lecturas que necesita la venta del portal (T-17). La escritura de la venta
 * sigue en `VentasRepository`, la misma que usa la tablet.
 */
@Injectable()
export class VentasPortalRepository {
  constructor(@Inject(DB_CONNECTION) private readonly db: Database) {}

  buscarSucursalUsuario(usuarioId: string) {
    return buscarSucursalUsuarioCompartido(this.db, usuarioId);
  }

  /** La venta, el folio OF y el cobro de contado entran o salen juntos. */
  enTransaccion<T>(tarea: (trx: Transaction<DB>) => Promise<T>): Promise<T> {
    return this.db.transaction().execute(tarea);
  }

  /**
   * El cliente, vivo, con su sucursal. **Sin filtrar por `tipo`**: la tablet
   * tampoco prohibe venderle a un prospecto (§3).
   */
  async clienteDeVenta(
    clienteId: string,
    conexion: Database = this.db,
  ): Promise<ClienteDeVenta | undefined> {
    const fila = await conexion
      .selectFrom('cliente')
      .innerJoin('sucursal', 'sucursal.id', 'cliente.sucursal_id')
      .select([
        'cliente.id as id',
        'cliente.sucursal_id as sucursal_id',
        'sucursal.codigo as codigo',
      ])
      .where('cliente.id', '=', clienteId)
      .where('cliente.deleted_at', 'is', null)
      .executeTakeFirst();
    return fila
      ? {
          id: fila.id,
          sucursalId: fila.sucursal_id,
          sucursalCodigo: fila.codigo,
        }
      : undefined;
  }

  async codigoDeSucursal(sucursalId: string): Promise<string | undefined> {
    const fila = await this.db
      .selectFrom('sucursal')
      .select('codigo')
      .where('id', '=', sucursalId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    return fila?.codigo;
  }

  /** Activos y vivos: un vendedor desactivado no sale a repartir. */
  async repartidoresActivos(sucursalId: string): Promise<Repartidor[]> {
    return this.db
      .selectFrom('vendedor')
      .select(['id', 'nombre'])
      .where('sucursal_id', '=', sucursalId)
      .where('activo', '=', true)
      .where('deleted_at', 'is', null)
      .orderBy('nombre')
      .execute();
  }

  async esRepartidorActivo(
    vendedorId: string,
    sucursalId: string,
    trx: Transaction<DB>,
  ): Promise<boolean> {
    const fila = await trx
      .selectFrom('vendedor')
      .select('id')
      .where('id', '=', vendedorId)
      .where('sucursal_id', '=', sucursalId)
      .where('activo', '=', true)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    return fila !== undefined;
  }

  /**
   * Bloquea la fila del vendedor (`for no key update OF v`, sin la sucursal) y
   * devuelve la casilla de inventario de su sucursal. Es el candado de las
   * cargas, la ruta del dia y el corte: dos ventas del portal del mismo
   * vendedor se aplican una despues de la otra y la segunda ve la existencia
   * que dejo la primera. `undefined` si no existe o esta dado de baja.
   */
  async bloquearVendedorConInventario(
    vendedorId: string,
    trx: Transaction<DB>,
  ): Promise<VendedorConInventario | undefined> {
    const r = await sql<{
      id: string;
      nombre: string;
      control_inventario: boolean;
    }>`
      select v.id, v.nombre, s.control_inventario
        from vendedor v
        join sucursal s on s.id = v.sucursal_id
       where v.id = ${vendedorId}::uuid
         and v.deleted_at is null
         for no key update of v
    `.execute(trx);
    const f = r.rows[0];
    return (
      f && {
        id: f.id,
        nombre: f.nombre,
        controlInventario: f.control_inventario,
      }
    );
  }

  /** Producto y volumen de cada presentacion, para pintar el catalogo. */
  async nombresDePresentaciones(
    ids: readonly string[],
    conexion: Database,
  ): Promise<Map<string, { producto: string; volumen: string }>> {
    if (ids.length === 0) return new Map();
    const filas = await conexion
      .selectFrom('presentacion as pr')
      .innerJoin('producto as p', 'p.id', 'pr.producto_id')
      .select(['pr.id as id', 'p.nombre as producto', 'pr.volumen as volumen'])
      .where('pr.id', 'in', ids)
      .execute();
    return new Map(
      filas.map((f) => [f.id, { producto: f.producto, volumen: f.volumen }]),
    );
  }
}
