import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { isUUID } from 'class-validator';
import {
  normalizarSucursalPedida,
  resolverAlcance,
} from '../sucursales/alcance-sucursal';
import type {
  DetalleDiaDto,
  DetalleVendedorDto,
  FlujoDiarioDto,
} from './dto/flujo-diario.dto';
import { validarRango } from './reglas-kilometraje';
import { armarFlujoDiario, type FlujoDiario } from './reglas-flujo-diario';
import { FlujoDiarioRepository } from './flujo-diario.repository';
import { DetalleRepository } from './detalle.repository';
import {
  armarDetalleDia,
  armarDetalleVendedor,
  type DetalleDia,
  type DetalleVendedorDia,
} from './reglas-detalle';

@Injectable()
export class FlujoDiarioService {
  constructor(
    private readonly repo: FlujoDiarioRepository,
    private readonly detalle: DetalleRepository,
  ) {}

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

  async alcanceDe(usuarioId: string, sucursal: string | undefined) {
    // El guard valido la firma del token, no que el usuario siga existiendo.
    const usuario = await this.repo.buscarSucursalUsuario(usuarioId);
    if (!usuario) throw new UnauthorizedException('Sesion invalida.');
    return resolverAlcance(usuario.codigo, normalizarSucursalPedida(sucursal));
  }

  private validarDia(fecha: string): void {
    const error = validarRango(fecha, fecha);
    if (error) throw new BadRequestException(error);
  }

  private idVendedor(crudo: string): string {
    const limpio = crudo.trim();
    if (!isUUID(limpio))
      throw new BadRequestException('El vendedor no es válido.');
    return limpio.toLowerCase();
  }

  /** `codigo` null = cualquier sucursal (General sin filtro). */
  private async vendedorEnAlcance(id: string, codigo: string | null) {
    const vendedor = await this.detalle.buscarVendedor(id);
    // Otra sucursal se contesta igual que un vendedor inexistente.
    if (!vendedor || (codigo !== null && codigo !== vendedor.codigo))
      throw new NotFoundException('No encontramos ese vendedor.');
    return vendedor;
  }

  async detalleVendedor(
    usuarioId: string,
    q: DetalleVendedorDto,
  ): Promise<DetalleVendedorDia> {
    this.validarDia(q.fecha);
    const id = this.idVendedor(q.vendedor);
    const alcance = await this.alcanceDe(usuarioId, q.sucursal);
    const vendedor = await this.vendedorEnAlcance(
      id,
      alcance.tipo === 'una' ? alcance.codigo : null,
    );

    const [filas, jornadaCerrada] = await Promise.all([
      this.detalle.filas({ vendedorId: vendedor.id }, q.fecha),
      this.detalle.tieneJornada(vendedor.id, q.fecha),
    ]);
    return armarDetalleVendedor(
      {
        fecha: q.fecha,
        vendedorId: vendedor.id,
        vendedor: vendedor.nombre,
        jornadaCerrada,
      },
      filas,
    );
  }

  async detalleDia(usuarioId: string, q: DetalleDiaDto): Promise<DetalleDia> {
    this.validarDia(q.fecha);
    const crudo = q.vendedor?.trim();
    const id = crudo ? this.idVendedor(crudo) : null;
    const alcance = await this.alcanceDe(usuarioId, q.sucursal);
    if (alcance.tipo === 'todas')
      throw new BadRequestException('Elige una sucursal.');
    if (!(await this.detalle.existeSucursal(alcance.codigo)))
      throw new NotFoundException('No encontramos esa sucursal.');
    // Con un vendedor, el dia es solo suyo: sin la oficina, igual que su
    // renglon "Por dia" (`flujo` con vendedor).
    const vendedor = id
      ? await this.vendedorEnAlcance(id, alcance.codigo)
      : null;
    const filas = await this.detalle.filas(
      vendedor
        ? { vendedorId: vendedor.id }
        : { sucursalCodigo: alcance.codigo },
      q.fecha,
    );
    return armarDetalleDia(
      { fecha: q.fecha, sucursalCodigo: alcance.codigo },
      filas,
    );
  }
}
