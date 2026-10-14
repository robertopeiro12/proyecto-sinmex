import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { isUUID } from 'class-validator';
import {
  normalizarSucursalPedida,
  resolverAlcance,
} from '../sucursales/alcance-sucursal';
import type { ReporteVentasDto } from './dto/reporte-ventas.dto';
import { validarRango } from './reglas-kilometraje';
import {
  armarReporteVentas,
  type ReporteVentas,
} from './reglas-reporte-ventas';
import {
  ReporteVentasRepository,
  type FiltroRepartidor,
} from './reporte-ventas.repository';

@Injectable()
export class ReporteVentasService {
  constructor(private readonly repo: ReporteVentasRepository) {}

  async ventas(usuarioId: string, q: ReporteVentasDto): Promise<ReporteVentas> {
    const error = validarRango(q.desde, q.hasta);
    if (error) throw new BadRequestException(error);
    const repartidor = interpretarRepartidor(q.repartidor);

    // El guard valido la firma del token, no que el usuario siga existiendo.
    const usuario = await this.repo.buscarSucursalUsuario(usuarioId);
    if (!usuario) throw new UnauthorizedException('Sesion invalida.');
    const alcance = resolverAlcance(
      usuario.codigo,
      normalizarSucursalPedida(q.sucursal),
    );

    const filas = await this.repo.ventas({
      desde: q.desde,
      hasta: q.hasta,
      codigoSucursal: alcance.tipo === 'una' ? alcance.codigo : null,
      repartidor,
    });
    return armarReporteVentas(q.desde, q.hasta, filas);
  }
}

function interpretarRepartidor(crudo: string | undefined): FiltroRepartidor {
  const valor = crudo?.trim();
  if (!valor) return { tipo: 'todos' };
  if (valor.toLowerCase() === 'oficina') return { tipo: 'oficina' };
  if (isUUID(valor)) return { tipo: 'vendedor', id: valor.toLowerCase() };
  throw new BadRequestException('El repartidor no es válido.');
}
