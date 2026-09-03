import { Inject, Injectable } from '@nestjs/common';
import type { Transaction } from 'kysely';
import { DB_CONNECTION, type Database } from '../../database/database.tokens';
import type { DB } from '../../database/schema';
import { buscarSucursalUsuario } from '../sucursales/buscar-sucursal-usuario';

export interface ExcepcionConId {
  permiso_id: string;
  habilitado: boolean;
}

export interface DatosUsuarioBase {
  login: string;
  nombre: string;
  perfil_id: string;
  sucursal_id: string | null;
}

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

function aResumen(fila: FilaUsuario): UsuarioResumen {
  return {
    id: fila.id,
    login: fila.login,
    nombre: fila.nombre,
    perfil: fila.perfil_nombre,
    perfilId: fila.perfil_id,
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
    return filas.map(aResumen);
  }

  async listarPorCodigoSucursal(codigo: string): Promise<UsuarioResumen[]> {
    const filas = await this.consultaBase()
      .where('sucursal.codigo', '=', codigo)
      .orderBy('usuario.nombre')
      .execute();
    return filas.map(aResumen);
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

  async crear(
    datos: DatosUsuarioBase & { password_hash: string },
    excepciones: ExcepcionConId[],
  ): Promise<UsuarioBase> {
    const id = await this.db.transaction().execute(async (trx) => {
      const usuario = await trx
        .insertInto('usuario')
        .values({
          login: datos.login,
          nombre: datos.nombre,
          password_hash: datos.password_hash,
          perfil_id: datos.perfil_id,
          sucursal_id: datos.sucursal_id,
        })
        .returning('id')
        .executeTakeFirstOrThrow();

      await this.reemplazarExcepciones(trx, usuario.id, excepciones);
      return usuario.id;
    });

    return (await this.obtener(id))!;
  }

  /**
   * Reconcilia usuario_permiso contra el estado final que ya trae resuelto
   * el servicio (D3 del spec): da de baja toda excepcion vigente que ya NO
   * este en la lista nueva, y hace upsert de cada una que si -- mismo
   * patron de "on conflict … do update set deleted_at = null" que
   * PerfilesRepository.togglePermiso() (T-08b) usa para perfil_permiso,
   * fila por fila porque el catalogo de permisos es chico (~25 filas) y ya
   * es el mismo criterio que ClientesRepository.actualizar() (T-12) sigue
   * para sus overrides de precio.
   */
  private async reemplazarExcepciones(
    trx: Transaction<DB>,
    usuarioId: string,
    excepciones: ExcepcionConId[],
  ): Promise<void> {
    const idsVigentes = excepciones.map((e) => e.permiso_id);
    const baja = trx
      .updateTable('usuario_permiso')
      .set({ deleted_at: new Date() })
      .where('usuario_id', '=', usuarioId)
      .where('deleted_at', 'is', null);
    await (
      idsVigentes.length > 0
        ? baja.where('permiso_id', 'not in', idsVigentes)
        : baja
    ).execute();

    for (const excepcion of excepciones) {
      await trx
        .insertInto('usuario_permiso')
        .values({
          usuario_id: usuarioId,
          permiso_id: excepcion.permiso_id,
          habilitado: excepcion.habilitado,
        })
        .onConflict((oc) =>
          oc.columns(['usuario_id', 'permiso_id']).doUpdateSet({
            habilitado: excepcion.habilitado,
            deleted_at: null,
          }),
        )
        .execute();
    }
  }
}
