import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import {
  normalizarSucursalPedida,
  resolverAlcance,
} from '../sucursales/alcance-sucursal';
import type { ReporteKilometrajeDto } from './dto/reporte-kilometraje.dto';
import {
  armarReporte,
  validarRango,
  type ReporteKilometraje,
} from './reglas-kilometraje';
import { ReporteKilometrajeRepository } from './reporte-kilometraje.repository';

@Injectable()
export class ReporteKilometrajeService {
  constructor(private readonly repo: ReporteKilometrajeRepository) {}

  async kilometraje(
    usuarioId: string,
    q: ReporteKilometrajeDto,
  ): Promise<ReporteKilometraje> {
    const error = validarRango(q.desde, q.hasta);
    if (error) throw new BadRequestException(error);

    // El guard valido la firma del token, no que el usuario siga existiendo.
    const usuario = await this.repo.buscarSucursalUsuario(usuarioId);
    if (!usuario) throw new UnauthorizedException('Sesion invalida.');
    const alcance = resolverAlcance(
      usuario.codigo,
      normalizarSucursalPedida(q.sucursal),
    );

    const filas = await this.repo.jornadas({
      desde: q.desde,
      hasta: q.hasta,
      vehiculoId: q.vehiculo ?? null,
      codigoSucursal: alcance.tipo === 'una' ? alcance.codigo : null,
    });
    return armarReporte(q.desde, q.hasta, filas);
  }
}
