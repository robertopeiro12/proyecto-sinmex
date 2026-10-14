import { Injectable, UnauthorizedException } from '@nestjs/common';
import {
  normalizarSucursalPedida,
  resolverAlcance,
} from '../sucursales/alcance-sucursal';
import { CuentasPorCobrarRepository } from './cuentas-por-cobrar.repository';
import type { CuentasPorCobrarDto } from './dto/cuentas-por-cobrar.dto';
import {
  armarCuentasPorCobrar,
  type CuentasPorCobrar,
} from './reglas-cuentas-por-cobrar';

@Injectable()
export class CuentasPorCobrarService {
  constructor(private readonly repo: CuentasPorCobrarRepository) {}

  async consultar(
    usuarioId: string,
    q: CuentasPorCobrarDto,
  ): Promise<CuentasPorCobrar> {
    // El guard valido la firma del token, no que el usuario siga existiendo.
    const usuario = await this.repo.buscarSucursalUsuario(usuarioId);
    if (!usuario) throw new UnauthorizedException('Sesion invalida.');
    const alcance = resolverAlcance(
      usuario.codigo,
      normalizarSucursalPedida(q.sucursal),
    );

    const hoy = await this.repo.hoyEnTijuana();
    const filas = await this.repo.notas(
      hoy,
      alcance.tipo === 'una' ? alcance.codigo : null,
    );
    return armarCuentasPorCobrar(hoy, filas, {
      soloVencidas: q.soloVencidas === 'true',
    });
  }
}
