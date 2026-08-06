import { Injectable, UnauthorizedException } from '@nestjs/common';
import { resolverAlcance, type Alcance } from './alcance-sucursal';
import { SucursalesRepository, type Sucursal } from './sucursales.repository';

@Injectable()
export class SucursalesService {
  constructor(private readonly repo: SucursalesRepository) {}

  async listar(
    usuarioId: string,
    sucursalPedida: string | null,
  ): Promise<Sucursal[]> {
    const alcance = await this.alcanceDe(usuarioId, sucursalPedida);
    return alcance.tipo === 'todas'
      ? this.repo.listar()
      : this.repo.listarPorCodigo(alcance.codigo);
  }

  /**
   * El JWT solo lleva `sub` y `tipo` (decision de T-06), asi que la sucursal
   * del usuario no viaja en el token y hay que consultarla. Es una lectura por
   * PK con un join; meterla en el token o cachearla corresponde a T-08, cuando
   * el guard tenga que cargar tambien los permisos y valga la pena resolver el
   * problema una sola vez para todo.
   */
  private async alcanceDe(
    usuarioId: string,
    sucursalPedida: string | null,
  ): Promise<Alcance> {
    const fila = await this.repo.buscarSucursalDeUsuario(usuarioId);
    // El guard valido la FIRMA del token, no que el usuario siga existiendo.
    // Un token vivo de alguien dado de baja llega hasta aqui.
    if (!fila) {
      throw new UnauthorizedException('Sesion invalida.');
    }
    return resolverAlcance(fila.codigo, sucursalPedida);
  }
}
