import { Injectable, UnauthorizedException } from '@nestjs/common';
import { resolverAlcance, type Alcance } from '../sucursales/alcance-sucursal';
import { VendedoresRepository, type Vendedor } from './vendedores.repository';

@Injectable()
export class VendedoresService {
  constructor(private readonly repo: VendedoresRepository) {}

  async listar(
    usuarioId: string,
    sucursalPedida: string | null,
  ): Promise<Vendedor[]> {
    const alcance = await this.alcanceDe(usuarioId, sucursalPedida);
    return alcance.tipo === 'todas'
      ? this.repo.listar()
      : this.repo.listarPorCodigoSucursal(alcance.codigo);
  }

  protected async alcanceDe(
    usuarioId: string,
    sucursalPedida: string | null,
  ): Promise<Alcance> {
    const fila = await this.repo.buscarSucursalUsuario(usuarioId);
    if (!fila) {
      throw new UnauthorizedException('Sesion invalida.');
    }
    return resolverAlcance(fila.codigo, sucursalPedida);
  }
}
