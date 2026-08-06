import { Inject, Injectable } from '@nestjs/common';
import { DB_CONNECTION, type Database } from '../../database/database.tokens';

export interface Sucursal {
  id: string;
  codigo: string;
  nombre: string;
  activa: boolean;
}

/** Las columnas que salen a la API. `deleted_at` nunca se expone (ver D6). */
const CAMPOS = ['id', 'codigo', 'nombre', 'activa'] as const;

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
