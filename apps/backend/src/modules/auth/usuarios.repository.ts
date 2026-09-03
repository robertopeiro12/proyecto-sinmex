import { Inject, Injectable } from '@nestjs/common';
import { DB_CONNECTION, type Database } from '../../database/database.tokens';
import { buscarSucursalUsuario } from '../sucursales/buscar-sucursal-usuario';

export interface UsuarioResumen {
  id: string;
  login: string;
  nombre: string;
  perfil: string;
  perfilId: string;
  sucursalCodigo: string | null;
}

/** Lo mismo que UsuarioResumen, mas el id de sucursal (crudo, para el formulario). */
export interface UsuarioBase extends UsuarioResumen {
  sucursalId: string | null;
}

export interface UsuarioDetalle extends UsuarioBase {
  /** Perfil + excepciones ya combinados (D3 del spec) -- precarga la matriz del formulario de edicion. */
  permisosEfectivos: string[];
}

interface FilaUsuario {
  id: string;
  login: string;
  nombre: string;
  perfil_id: string;
  perfil_nombre: string;
  sucursal_id: string | null;
  sucursal_codigo: string | null;
}

function aBase(fila: FilaUsuario): UsuarioBase {
  return {
    id: fila.id,
    login: fila.login,
    nombre: fila.nombre,
    perfil: fila.perfil_nombre,
    perfilId: fila.perfil_id,
    sucursalId: fila.sucursal_id,
    sucursalCodigo: fila.sucursal_codigo,
  };
}

@Injectable()
export class UsuariosRepository {
  constructor(@Inject(DB_CONNECTION) private readonly db: Database) {}

  private consultaBase() {
    return this.db
      .selectFrom('usuario')
      .innerJoin('perfil', 'perfil.id', 'usuario.perfil_id')
      .leftJoin('sucursal', 'sucursal.id', 'usuario.sucursal_id')
      .select([
        'usuario.id as id',
        'usuario.login as login',
        'usuario.nombre as nombre',
        'usuario.perfil_id as perfil_id',
        'perfil.nombre as perfil_nombre',
        'usuario.sucursal_id as sucursal_id',
        'sucursal.codigo as sucursal_codigo',
      ])
      .where('usuario.deleted_at', 'is', null);
  }

  async listar(): Promise<UsuarioResumen[]> {
    const filas = await this.consultaBase().orderBy('usuario.nombre').execute();
    return filas.map(aBase);
  }

  async listarPorCodigoSucursal(codigo: string): Promise<UsuarioResumen[]> {
    const filas = await this.consultaBase()
      .where('sucursal.codigo', '=', codigo)
      .orderBy('usuario.nombre')
      .execute();
    return filas.map(aBase);
  }

  async obtener(id: string): Promise<UsuarioBase | undefined> {
    const fila = await this.consultaBase()
      .where('usuario.id', '=', id)
      .executeTakeFirst();
    return fila ? aBase(fila) : undefined;
  }

  /** Delegado al helper compartido (D9 del plan de T-12). */
  async buscarSucursalUsuario(
    usuarioId: string,
  ): Promise<{ id: string | null; codigo: string | null } | undefined> {
    return buscarSucursalUsuario(this.db, usuarioId);
  }
}
