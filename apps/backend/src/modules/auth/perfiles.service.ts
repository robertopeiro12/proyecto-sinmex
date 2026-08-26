import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { esMaestro } from './permisos';
import {
  PerfilesRepository,
  type Permiso,
  type PerfilResumen,
} from './perfiles.repository';

/**
 * `23505` es unique_violation. Se mira DESPUES del insert en vez de consultar
 * antes si el nombre existe -- mismo criterio "la base decide" que T-09,
 * T-10, T-11 y T-18: una consulta previa deja una ventana entre el SELECT y
 * el INSERT en la que otra peticion puede meter el mismo nombre.
 */
function esDuplicado(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === '23505'
  );
}

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

  async crear(nombre: string): Promise<PerfilResumen> {
    try {
      return await this.repo.crear(nombre);
    } catch (error) {
      if (esDuplicado(error)) {
        throw new ConflictException(`Ya existe un perfil llamado "${nombre}".`);
      }
      throw error;
    }
  }

  async renombrar(id: string, nombre: string): Promise<PerfilResumen> {
    const perfil = await this.buscarActivoOFallar(id);
    if (esMaestro(perfil.nombre)) {
      throw new ConflictException('El perfil maestro no se puede renombrar.');
    }
    try {
      return await this.repo.renombrar(id, nombre);
    } catch (error) {
      if (esDuplicado(error)) {
        throw new ConflictException(`Ya existe un perfil llamado "${nombre}".`);
      }
      throw error;
    }
  }

  /**
   * Compartido por renombrar/dar de baja/togglear (Tasks 4-6): las tres
   * operaciones necesitan el nombre ACTUAL del perfil para decidir si es el
   * maestro (D2), y las tres deben responder 404 igual si el id no existe.
   */
  private async buscarActivoOFallar(id: string): Promise<PerfilResumen> {
    const perfil = await this.repo.buscarPorId(id);
    if (!perfil) {
      throw new NotFoundException('No existe ese perfil.');
    }
    return perfil;
  }
}
