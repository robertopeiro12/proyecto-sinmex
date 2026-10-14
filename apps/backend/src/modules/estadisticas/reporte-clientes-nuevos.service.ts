import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import {
  normalizarSucursalPedida,
  resolverAlcance,
} from '../sucursales/alcance-sucursal';
import type { ReporteClientesNuevosDto } from './dto/reporte-clientes-nuevos.dto';
import { validarRango } from './reglas-kilometraje';
import {
  armarReporteClientesNuevos,
  type ReporteClientesNuevos,
} from './reglas-clientes-nuevos';
import { ReporteClientesNuevosRepository } from './reporte-clientes-nuevos.repository';

@Injectable()
export class ReporteClientesNuevosService {
  constructor(private readonly repo: ReporteClientesNuevosRepository) {}

  async clientesNuevos(
    usuarioId: string,
    q: ReporteClientesNuevosDto,
  ): Promise<ReporteClientesNuevos> {
    const error = validarRango(q.desde, q.hasta);
    if (error) throw new BadRequestException(error);

    // El guard valido la firma del token, no que el usuario siga existiendo.
    const usuario = await this.repo.buscarSucursalUsuario(usuarioId);
    if (!usuario) throw new UnauthorizedException('Sesion invalida.');
    const alcance = resolverAlcance(
      usuario.codigo,
      normalizarSucursalPedida(q.sucursal),
    );

    const filas = await this.repo.clientes({
      desde: q.desde,
      hasta: q.hasta,
      codigoSucursal: alcance.tipo === 'una' ? alcance.codigo : null,
    });
    return armarReporteClientesNuevos(q.desde, q.hasta, filas);
  }
}
