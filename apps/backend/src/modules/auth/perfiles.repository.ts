import { Inject, Injectable } from '@nestjs/common';
import { DB_CONNECTION, type Database } from '../../database/database.tokens';

export interface Permiso {
  id: string;
  clave: string;
  grupo: string;
  descripcion: string | null;
}

export interface PerfilResumen {
  id: string;
  nombre: string;
}

export interface Asignacion {
  perfilId: string;
  clave: string;
}

/**
 * Orden de las cuatro categorias en la matriz (D5 del spec). Son valores de
 * dato de `permiso.grupo`, no etiquetas de interfaz -- mismo criterio que ya
 * fijo T-08a para 'sucursal.gestionar'.
 */
const ORDEN_GRUPOS = [
  'General',
  'Operacion Comercial',
  'Produccion/Almacen',
  'Informacion',
];

@Injectable()
export class PerfilesRepository {
  constructor(@Inject(DB_CONNECTION) private readonly db: Database) {}

  /** Ordenado por grupo (orden fijo de negocio) y luego por clave. */
  async catalogoPermisos(): Promise<Permiso[]> {
    const filas = await this.db
      .selectFrom('permiso')
      .select(['id', 'clave', 'grupo', 'descripcion'])
      .where('deleted_at', 'is', null)
      .execute();

    return filas.sort((a, b) => {
      const diferenciaGrupo =
        ORDEN_GRUPOS.indexOf(a.grupo) - ORDEN_GRUPOS.indexOf(b.grupo);
      return diferenciaGrupo !== 0
        ? diferenciaGrupo
        : a.clave.localeCompare(b.clave);
    });
  }

  async listarPerfiles(): Promise<PerfilResumen[]> {
    return this.db
      .selectFrom('perfil')
      .select(['id', 'nombre'])
      .where('deleted_at', 'is', null)
      .orderBy('nombre')
      .execute();
  }

  /**
   * Todas las asignaciones activas de TODOS los perfiles en una sola
   * consulta -- evita un N+1 (una consulta por perfil) que la Task 2 tendria
   * que resolver de todos modos en cuanto hubiera mas de un perfil normal.
   */
  async listarAsignaciones(): Promise<Asignacion[]> {
    return this.db
      .selectFrom('perfil_permiso')
      .innerJoin('permiso', 'permiso.id', 'perfil_permiso.permiso_id')
      .select([
        'perfil_permiso.perfil_id as perfilId',
        'permiso.clave as clave',
      ])
      .where('perfil_permiso.deleted_at', 'is', null)
      .where('permiso.deleted_at', 'is', null)
      .execute();
  }

  async buscarPorId(id: string): Promise<PerfilResumen | undefined> {
    return this.db
      .selectFrom('perfil')
      .select(['id', 'nombre'])
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
  }

  async crear(nombre: string): Promise<PerfilResumen> {
    return this.db
      .insertInto('perfil')
      .values({ nombre })
      .returning(['id', 'nombre'])
      .executeTakeFirstOrThrow();
  }
}
