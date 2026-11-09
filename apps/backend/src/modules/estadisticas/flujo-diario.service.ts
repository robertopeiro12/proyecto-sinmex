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
import type { FlujoDiarioDto } from './dto/flujo-diario.dto';
import { validarRango } from './reglas-kilometraje';
import { armarFlujoDiario, type FlujoDiario } from './reglas-flujo-diario';
import { FlujoDiarioRepository } from './flujo-diario.repository';

@Injectable()
export class FlujoDiarioService {
  constructor(private readonly repo: FlujoDiarioRepository) {}

  async flujo(usuarioId: string, q: FlujoDiarioDto): Promise<FlujoDiario> {
    const error = validarRango(q.desde, q.hasta);
    if (error) throw new BadRequestException(error);
    const crudo = q.vendedor?.trim();
    if (crudo && !isUUID(crudo))
      throw new BadRequestException('El vendedor no es válido.');
    const vendedorId = crudo ? crudo.toLowerCase() : null;

    // El guard valido la firma del token, no que el usuario siga existiendo.
    const usuario = await this.repo.buscarSucursalUsuario(usuarioId);
    if (!usuario) throw new UnauthorizedException('Sesion invalida.');
    const alcance = resolverAlcance(
      usuario.codigo,
      normalizarSucursalPedida(q.sucursal),
    );
    const filtro = {
      desde: q.desde,
      hasta: q.hasta,
      codigoSucursal: alcance.tipo === 'una' ? alcance.codigo : null,
    };

    const filas = await this.repo.filas({ ...filtro, vendedorId });
    // Con un vendedor elegido, "Por dia" suma solo a el: sin la oficina.
    const oficina = vendedorId ? [] : await this.repo.oficina(filtro);
    return armarFlujoDiario(q.desde, q.hasta, filas, oficina);
  }
}
