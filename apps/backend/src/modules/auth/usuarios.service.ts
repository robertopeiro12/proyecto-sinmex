import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { resolverAlcance, type Alcance } from '../sucursales/alcance-sucursal';
import { PerfilesService, type MatrizPerfiles } from './perfiles.service';
import { PermisosRepository } from './permisos.repository';
import {
  UsuariosRepository,
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
}
