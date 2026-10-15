import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { resolverAlcance, type Alcance } from '../sucursales/alcance-sucursal';
import type { CrearCuentaDto, RenombrarCuentaDto } from './dto/tesoreria.dto';
import type { CuentaEnAlcance } from './reglas-saldo';
import { TesoreriaRepository } from './tesoreria.repository';

const MENSAJE_DUPLICADA = 'Ya existe una cuenta con ese nombre.';
const MENSAJE_GENERAL =
  'Las cuentas generales solo las administra un usuario General.';

/** `23505` unique_violation y `23503` foreign_key_violation (ver vehiculos.service.ts). */
function codigoPg(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error))
    return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

interface UsuarioSucursal {
  id: string | null;
  codigo: string | null;
}

@Injectable()
export class TesoreriaService {
  constructor(private readonly repo: TesoreriaRepository) {}

  async listarCuentas(
    usuarioId: string,
    sucursalPedida: string | null,
  ): Promise<CuentaEnAlcance[]> {
    const alcance = await this.alcanceDe(usuarioId, sucursalPedida);
    return this.repo.listarCuentas(
      alcance.tipo === 'todas' ? null : alcance.codigo,
    );
  }

  async crearCuenta(
    usuarioId: string,
    dto: CrearCuentaDto,
  ): Promise<CuentaEnAlcance> {
    const usuario = await this.usuario(usuarioId);
    // Atado: la suya, se ignora lo que mande. General: lo que mande, o general.
    const sucursalId = usuario.id ?? dto.sucursalId ?? null;
    try {
      return await this.repo.crearCuenta(dto.nombre, sucursalId);
    } catch (error) {
      if (codigoPg(error) === '23505')
        throw new ConflictException(MENSAJE_DUPLICADA);
      if (codigoPg(error) === '23503')
        throw new BadRequestException('La sucursal no existe.');
      throw error;
    }
  }

  async renombrarCuenta(
    usuarioId: string,
    id: string,
    dto: RenombrarCuentaDto,
  ): Promise<CuentaEnAlcance> {
    await this.cuentaModificable(usuarioId, id);
    try {
      return await this.repo.renombrarCuenta(id, dto.nombre);
    } catch (error) {
      if (codigoPg(error) === '23505')
        throw new ConflictException(MENSAJE_DUPLICADA);
      throw error;
    }
  }

  async eliminarCuenta(usuarioId: string, id: string): Promise<void> {
    await this.cuentaModificable(usuarioId, id);
    await this.repo.eliminarCuenta(id);
  }

  /**
   * La cuenta viva que el usuario puede MODIFICAR (spec §3.2):
   *   - no existe / dada de baja / de otra sucursal -> 404 (no se revela)
   *   - general y el usuario esta atado a una sucursal -> 403
   */
  async cuentaModificable(
    usuarioId: string,
    cuentaId: string,
  ): Promise<CuentaEnAlcance> {
    const usuario = await this.usuario(usuarioId);
    const cuenta = await this.repo.buscarCuenta(cuentaId);
    if (!cuenta) throw new NotFoundException('No existe esa cuenta.');
    if (usuario.id !== null) {
      if (cuenta.sucursalId === null)
        throw new ForbiddenException(MENSAJE_GENERAL);
      if (cuenta.sucursalId !== usuario.id)
        throw new NotFoundException('No existe esa cuenta.');
    }
    return cuenta;
  }

  protected async usuario(usuarioId: string): Promise<UsuarioSucursal> {
    // El guard valido la FIRMA del token, no que el usuario siga existiendo.
    const fila = await this.repo.buscarSucursalUsuario(usuarioId);
    if (!fila) throw new UnauthorizedException('Sesion invalida.');
    return fila;
  }

  protected async alcanceDe(
    usuarioId: string,
    sucursalPedida: string | null,
  ): Promise<Alcance> {
    const usuario = await this.usuario(usuarioId);
    return resolverAlcance(usuario.codigo, sucursalPedida);
  }
}
