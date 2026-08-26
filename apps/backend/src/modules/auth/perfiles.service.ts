import { Injectable } from '@nestjs/common';
import { esMaestro } from './permisos';
import { PerfilesRepository, type Permiso } from './perfiles.repository';

export interface PerfilConPermisos {
  id: string;
  nombre: string;
  esMaestro: boolean;
  permisos: string[];
}

export interface MatrizPerfiles {
  permisos: Permiso[];
  perfiles: PerfilConPermisos[];
}

@Injectable()
export class PerfilesService {
  constructor(private readonly repo: PerfilesRepository) {}

  /**
   * El maestro no consulta `perfil_permiso` (D2 del spec): sus filas ahi
   * siempre estarian vacias (permisos.repository.ts:43-44 corta antes de
   * llegar a esa tabla), asi que se le manda el catalogo completo -- misma
   * regla que `PermisosRepository.permisosDe()` ya aplica para la sesion.
   */
  async obtenerMatriz(): Promise<MatrizPerfiles> {
    const [permisos, perfiles, asignaciones] = await Promise.all([
      this.repo.catalogoPermisos(),
      this.repo.listarPerfiles(),
      this.repo.listarAsignaciones(),
    ]);

    const todasLasClaves = permisos.map((p) => p.clave);

    return {
      permisos,
      perfiles: perfiles.map((perfil) => {
        const maestro = esMaestro(perfil.nombre);
        return {
          id: perfil.id,
          nombre: perfil.nombre,
          esMaestro: maestro,
          permisos: maestro
            ? todasLasClaves
            : asignaciones
                .filter((a) => a.perfilId === perfil.id)
                .map((a) => a.clave),
        };
      }),
    };
  }
}
