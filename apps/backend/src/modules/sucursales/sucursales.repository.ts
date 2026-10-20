import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DB_CONNECTION, type Database } from '../../database/database.tokens';

export interface Sucursal {
  id: string;
  codigo: string;
  nombre: string;
  activa: boolean;
  /** T-27 (D7). */
  controlInventario: boolean;
}

/** Las columnas que salen a la API. `deleted_at` nunca se expone (ver D6). */
const CAMPOS = [
  'id',
  'codigo',
  'nombre',
  'activa',
  'control_inventario as controlInventario',
] as const;

@Injectable()
export class SucursalesRepository {
  constructor(@Inject(DB_CONNECTION) private readonly db: Database) {}

  /**
   * Devuelve activas E inactivas a proposito: la pantalla del catalogo
   * necesita ver una sucursal desactivada para poder reactivarla. Quien solo
   * quiera las activas (el selector) filtra por su cuenta.
   */
  async listar(): Promise<Sucursal[]> {
    return this.db
      .selectFrom('sucursal')
      .select(CAMPOS)
      .where('deleted_at', 'is', null)
      .orderBy('codigo')
      .execute();
  }

  async listarPorCodigo(codigo: string): Promise<Sucursal[]> {
    return this.db
      .selectFrom('sucursal')
      .select(CAMPOS)
      .where('deleted_at', 'is', null)
      .where('codigo', '=', codigo)
      .execute();
  }

  async crear(codigo: string, nombre: string): Promise<Sucursal> {
    return this.db
      .insertInto('sucursal')
      .values({ codigo, nombre })
      .returning(CAMPOS)
      .executeTakeFirstOrThrow();
  }

  async buscarPorId(id: string): Promise<Sucursal | undefined> {
    return this.db
      .selectFrom('sucursal')
      .select(CAMPOS)
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
  }

  /**
   * `cambios` nunca llega vacio: el servicio lo comprueba antes. Un `.set({})`
   * genera SQL invalido, asi que el chequeo no es cortesia, es necesario.
   *
   * T-27 (D7): si cambia `control_inventario`, en la MISMA transaccion se toca
   * `updated_at` de los vendedores de la sucursal. La tablet solo baja su propia
   * ficha de `vendedor` y la baja por `updated_at`: sin esto, el pull
   * incremental nunca le traeria la casilla nueva.
   */
  async actualizar(
    id: string,
    cambios: {
      nombre?: string;
      activa?: boolean;
      control_inventario?: boolean;
    },
    tocarVendedores: boolean,
  ): Promise<Sucursal> {
    return this.db.transaction().execute(async (trx) => {
      const sucursal = await trx
        .updateTable('sucursal')
        .set(cambios)
        .where('id', '=', id)
        .returning(CAMPOS)
        .executeTakeFirstOrThrow();
      if (tocarVendedores) {
        await trx
          .updateTable('vendedor')
          .set({ updated_at: sql<Date>`now()` })
          .where('sucursal_id', '=', id)
          .execute();
      }
      return sucursal;
    });
  }

  /**
   * El codigo de la sucursal del usuario. Distingue tres casos que NO se
   * pueden colapsar:
   *   - `undefined`      -> el usuario no existe o esta dado de baja
   *   - `{ codigo: null }` -> existe y es General
   *   - `{ codigo: 'TJ' }` -> existe y esta atado a Tijuana
   * Devolver `null` para los dos primeros convertiria a un usuario borrado en
   * uno con acceso a todas las sucursales.
   */
  async buscarSucursalDeUsuario(
    usuarioId: string,
  ): Promise<{ codigo: string | null } | undefined> {
    return this.db
      .selectFrom('usuario')
      .leftJoin('sucursal', 'sucursal.id', 'usuario.sucursal_id')
      .select('sucursal.codigo as codigo')
      .where('usuario.id', '=', usuarioId)
      .where('usuario.deleted_at', 'is', null)
      .executeTakeFirst();
  }
}
