import { Inject, Injectable } from '@nestjs/common';
import { DB_CONNECTION, type Database } from '../../database/database.tokens';
import { combinarPermisos, esMaestro, type Excepcion } from './permisos';

/**
 * Resuelve los permisos efectivos de un [[Usuario]] del portal.
 *
 * Consulta la base en CADA peticion, no al hacer login (D2): meter el set en
 * el JWT ahorraria consultas, pero un cambio de permisos tardaria hasta 15
 * minutos en surtir efecto — justo cuando uno quita un permiso porque hay un
 * problema en curso.
 *
 * Es el UNICO lugar donde se resuelve esto. Lo usan el PermisosGuard (para
 * decidir si deja pasar) y GET /auth/me (para decirle al portal que botones
 * pintar). Que ambos pregunten aqui es lo que hace imposible que el backend
 * permita algo que la interfaz esconde, o al reves.
 */
@Injectable()
export class PermisosRepository {
  constructor(@Inject(DB_CONNECTION) private readonly db: Database) {}

  async permisosDe(usuarioId: string): Promise<Set<string>> {
    const usuario = await this.db
      .selectFrom('usuario')
      .innerJoin('perfil', 'perfil.id', 'usuario.perfil_id')
      .select(['usuario.perfil_id as perfilId', 'perfil.nombre as perfil'])
      .where('usuario.id', '=', usuarioId)
      .where('usuario.deleted_at', 'is', null)
      .where('perfil.deleted_at', 'is', null)
      .executeTakeFirst();

    // Usuario inexistente o dado de baja -> CERO permisos. La misma trampa que
    // documenta buscarSucursalDeUsuario en sucursales.repository.ts: colapsar
    // "no existe" con cualquier otro caso convertiria a un usuario borrado en
    // uno con acceso.
    if (!usuario) {
      return new Set();
    }

    // D1: la excepcion del perfil maestro vive AQUI, en el resolutor, no en el
    // guard. Si viviera en el guard, /auth/me tendria que repetirla y las dos
    // copias se separarian tarde o temprano.
    if (esMaestro(usuario.perfil)) {
      return new Set(await this.catalogoCompleto());
    }

    const [delPerfil, excepciones] = await Promise.all([
      this.clavesDelPerfil(usuario.perfilId),
      this.excepcionesDe(usuarioId),
    ]);
    return combinarPermisos(delPerfil, excepciones);
  }

  private async catalogoCompleto(): Promise<string[]> {
    const filas = await this.db
      .selectFrom('permiso')
      .select('clave')
      .where('deleted_at', 'is', null)
      .execute();
    return filas.map((f) => f.clave);
  }

  private async clavesDelPerfil(perfilId: string): Promise<string[]> {
    const filas = await this.db
      .selectFrom('perfil_permiso')
      .innerJoin('permiso', 'permiso.id', 'perfil_permiso.permiso_id')
      .select('permiso.clave as clave')
      .where('perfil_permiso.perfil_id', '=', perfilId)
      .where('perfil_permiso.deleted_at', 'is', null)
      .where('permiso.deleted_at', 'is', null)
      .execute();
    return filas.map((f) => f.clave);
  }

  private async excepcionesDe(usuarioId: string): Promise<Excepcion[]> {
    return this.db
      .selectFrom('usuario_permiso')
      .innerJoin('permiso', 'permiso.id', 'usuario_permiso.permiso_id')
      .select([
        'permiso.clave as clave',
        'usuario_permiso.habilitado as habilitado',
      ])
      .where('usuario_permiso.usuario_id', '=', usuarioId)
      .where('usuario_permiso.deleted_at', 'is', null)
      .where('permiso.deleted_at', 'is', null)
      .execute();
  }
}
