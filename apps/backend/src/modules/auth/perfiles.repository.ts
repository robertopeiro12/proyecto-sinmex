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

  async renombrar(id: string, nombre: string): Promise<PerfilResumen> {
    return this.db
      .updateTable('perfil')
      .set({ nombre })
      .where('id', '=', id)
      .returning(['id', 'nombre'])
      .executeTakeFirstOrThrow();
  }

  async contarUsuariosActivos(perfilId: string): Promise<number> {
    const fila = await this.db
      .selectFrom('usuario')
      .select((eb) => eb.fn.countAll<string>().as('total'))
      .where('perfil_id', '=', perfilId)
      .where('deleted_at', 'is', null)
      .executeTakeFirstOrThrow();
    return Number(fila.total);
  }

  async darDeBaja(id: string): Promise<void> {
    await this.db
      .updateTable('perfil')
      .set({ deleted_at: new Date() })
      .where('id', '=', id)
      .execute();
  }

  async existePermiso(id: string): Promise<boolean> {
    const fila = await this.db
      .selectFrom('permiso')
      .select('id')
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    return fila !== undefined;
  }

  /**
   * `habilitado: true` -> upsert sobre el unique `(perfil_id, permiso_id)`
   * (T-05): si la fila no existia, la crea; si existia dada de baja (D del
   * spec de T-18, mismo criterio), la revive limpiando `deleted_at`.
   * `habilitado: false` -> baja logica de la fila si existe; si nunca
   * existio, no hay nada que hacer (el permiso ya esta "apagado" por
   * ausencia, que es el mismo estado final).
   */
  async togglePermiso(
    perfilId: string,
    permisoId: string,
    habilitado: boolean,
  ): Promise<void> {
    if (habilitado) {
      await this.db
        .insertInto('perfil_permiso')
        .values({ perfil_id: perfilId, permiso_id: permisoId })
        .onConflict((oc) =>
          oc
            .columns(['perfil_id', 'permiso_id'])
            .doUpdateSet({ deleted_at: null }),
        )
        .execute();
    } else {
      await this.db
        .updateTable('perfil_permiso')
        .set({ deleted_at: new Date() })
        .where('perfil_id', '=', perfilId)
        .where('permiso_id', '=', permisoId)
        .execute();
    }
  }
}
