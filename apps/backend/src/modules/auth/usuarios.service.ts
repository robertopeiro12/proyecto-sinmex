import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  esViolacionFk,
  esViolacionUnicidad,
} from '../../database/errores-postgres';
import { resolverAlcance, type Alcance } from '../sucursales/alcance-sucursal';
import { calcularExcepciones } from './calcular-excepciones';
import { PasswordService } from './password.service';
import { esMaestro } from './permisos';
import { PerfilesService, type MatrizPerfiles } from './perfiles.service';
import { PermisosRepository } from './permisos.repository';
import type { CrearUsuarioDto } from './dto/crear-usuario.dto';
import type { EditarUsuarioDto } from './dto/editar-usuario.dto';
import {
  UsuariosRepository,
  type ExcepcionConId,
  type UsuarioBase,
  type UsuarioDetalle,
  type UsuarioResumen,
} from './usuarios.repository';

@Injectable()
export class UsuariosService {
  constructor(
    private readonly repo: UsuariosRepository,
    private readonly perfiles: PerfilesService,
    private readonly permisosRepo: PermisosRepository,
    private readonly password: PasswordService,
  ) {}

  async catalogoPerfiles(): Promise<MatrizPerfiles> {
    return this.perfiles.obtenerMatriz();
  }

  async listar(
    usuarioId: string,
    sucursalPedida: string | null,
  ): Promise<UsuarioResumen[]> {
    const alcance = await this.alcanceDe(usuarioId, sucursalPedida);
    return alcance.tipo === 'todas'
      ? this.repo.listar()
      : this.repo.listarPorCodigoSucursal(alcance.codigo);
  }

  async obtener(usuarioId: string, id: string): Promise<UsuarioDetalle> {
    const usuario = await this.repo.obtener(id);
    if (!usuario) {
      throw new NotFoundException('No existe ese usuario.');
    }
    await this.exigirAlcanceSobre(usuarioId, usuario.sucursalCodigo);
    return this.aDetalle(usuario);
  }

  /** Compartido con Tasks 5-7: agrega los permisos efectivos a un UsuarioBase ya resuelto. */
  protected async aDetalle(base: UsuarioBase): Promise<UsuarioDetalle> {
    const permisos = await this.permisosRepo.permisosDe(base.id);
    return { ...base, permisosEfectivos: [...permisos] };
  }

  /** La fila cruda de sucursal del actor -- Tasks 5-7 la necesitan para D8 (resolver destino). */
  protected async filaActor(
    usuarioId: string,
  ): Promise<{ id: string | null; codigo: string | null }> {
    const fila = await this.repo.buscarSucursalUsuario(usuarioId);
    if (!fila) {
      throw new UnauthorizedException('Sesion invalida.');
    }
    return fila;
  }

  private async alcanceDe(
    usuarioId: string,
    sucursalPedida: string | null,
  ): Promise<Alcance> {
    const fila = await this.filaActor(usuarioId);
    return resolverAlcance(fila.codigo, sucursalPedida);
  }

  protected exigirAlcanceSobreCodigo(
    alcance: Alcance,
    codigo: string | null,
  ): void {
    if (alcance.tipo === 'una' && alcance.codigo !== codigo) {
      throw new ForbiddenException('No tienes acceso a esa sucursal.');
    }
  }

  private async exigirAlcanceSobre(
    usuarioId: string,
    codigo: string | null,
  ): Promise<void> {
    const alcance = await this.alcanceDe(usuarioId, null);
    this.exigirAlcanceSobreCodigo(alcance, codigo);
  }

  async crear(
    usuarioId: string,
    dto: CrearUsuarioDto,
  ): Promise<UsuarioDetalle> {
    const actor = await this.filaActor(usuarioId);
    // D8: si esta atado, la sucursal sale del alcance -- se ignora lo que
    // mande el body, mismo criterio que D6 de CrearClienteDto (T-12).
    const sucursalId = actor.id ?? dto.sucursalId ?? null;

    const matriz = await this.perfiles.obtenerMatriz();
    const perfil = matriz.perfiles.find((p) => p.id === dto.perfilId);
    if (!perfil) {
      throw new NotFoundException('No existe ese perfil.');
    }

    const excepciones = this.excepcionesConId(
      dto.permisosMarcados,
      perfil,
      matriz,
    );
    const hash = await this.password.hashear(dto.contrasena);

    try {
      const creado = await this.repo.crear(
        {
          login: dto.login,
          nombre: dto.nombre,
          password_hash: hash,
          perfil_id: dto.perfilId,
          sucursal_id: sucursalId,
        },
        excepciones,
      );
      return this.aDetalle(creado);
    } catch (error) {
      if (esViolacionUnicidad(error)) {
        throw new ConflictException(
          `Ya existe un usuario con el login "${dto.login}".`,
        );
      }
      if (esViolacionFk(error)) {
        throw new NotFoundException('Alguno de los datos enviados no existe.');
      }
      throw error;
    }
  }

  async editar(
    usuarioId: string,
    id: string,
    dto: EditarUsuarioDto,
  ): Promise<UsuarioDetalle> {
    const actual = await this.repo.obtener(id);
    if (!actual) {
      throw new NotFoundException('No existe ese usuario.');
    }

    const actor = await this.filaActor(usuarioId);
    const alcance = resolverAlcance(actor.codigo, null);
    // D8: la sucursal ACTUAL del editado tiene que estar dentro del
    // alcance de quien edita, igual que ClientesService.editar() (T-12).
    this.exigirAlcanceSobreCodigo(alcance, actual.sucursalCodigo);

    let sucursalId: string | null;
    if (actor.id === null) {
      // General: puede mover a cualquiera, incluida "General" (null).
      sucursalId = dto.sucursalId ?? null;
    } else {
      // Atado: el DESTINO tambien tiene que ser su propia sucursal (D8) --
      // variacion propia de T-13 sobre ClientesService, que ahi ni siquiera
      // deja mandar el campo (sucursal inmutable, T-12 D6).
      if (dto.sucursalId !== undefined && dto.sucursalId !== actor.id) {
        throw new ForbiddenException('No tienes acceso a esa sucursal.');
      }
      sucursalId = actor.id;
    }

    const matriz = await this.perfiles.obtenerMatriz();
    const perfilNuevo = matriz.perfiles.find((p) => p.id === dto.perfilId);
    if (!perfilNuevo) {
      throw new NotFoundException('No existe ese perfil.');
    }

    // D7 (mitad de PATCH): no dejar sin ningun Administrador General
    // activo. Solo aplica si el perfil ACTUAL es el maestro y el nuevo NO
    // lo es -- cualquier otro cambio de perfil no puede vaciar la cuenta.
    if (esMaestro(actual.perfil) && !perfilNuevo.esMaestro) {
      const activos = await this.repo.contarActivosConPerfil(actual.perfilId);
      if (activos <= 1) {
        throw new ConflictException(
          'Debe quedar al menos un Administrador General activo.',
        );
      }
    }

    const excepciones = this.excepcionesConId(
      dto.permisosMarcados,
      perfilNuevo,
      matriz,
    );
    const hash = dto.contrasena
      ? await this.password.hashear(dto.contrasena)
      : undefined;

    try {
      const actualizado = await this.repo.actualizar(
        id,
        {
          login: dto.login,
          nombre: dto.nombre,
          perfil_id: dto.perfilId,
          sucursal_id: sucursalId,
          password_hash: hash,
        },
        excepciones,
      );
      return this.aDetalle(actualizado);
    } catch (error) {
      if (esViolacionUnicidad(error)) {
        throw new ConflictException(
          `Ya existe un usuario con el login "${dto.login}".`,
        );
      }
      if (esViolacionFk(error)) {
        throw new NotFoundException('Alguno de los datos enviados no existe.');
      }
      throw error;
    }
  }

  /**
   * D4 del spec: el perfil maestro no consulta usuario_permiso
   * (permisos.repository.ts:43 corta antes) -- si el formulario de todos
   * modos manda permisosMarcados para un usuario con ese perfil, se ignora
   * en vez de escribir excepciones muertas.
   */
  protected excepcionesConId(
    marcados: string[],
    perfil: { esMaestro: boolean; permisos: string[] },
    matriz: MatrizPerfiles,
  ): ExcepcionConId[] {
    if (perfil.esMaestro) {
      return [];
    }
    const claveAId = new Map(matriz.permisos.map((p) => [p.clave, p.id]));
    const excepciones = calcularExcepciones(new Set(marcados), perfil.permisos);
    return excepciones
      .map((e) => ({
        permiso_id: claveAId.get(e.clave),
        habilitado: e.habilitado,
      }))
      .filter((e): e is ExcepcionConId => e.permiso_id !== undefined);
  }
}
