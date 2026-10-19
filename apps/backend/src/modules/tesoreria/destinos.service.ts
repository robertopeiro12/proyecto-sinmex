import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import {
  normalizarSucursalPedida,
  resolverAlcance,
} from '../sucursales/alcance-sucursal';
import type { GuardarDestinoDto, ListarDestinosDto } from './dto/destinos.dto';
import { DestinosRepository } from './destinos.repository';
import {
  METODOS_COBRANZA,
  destinoDe,
  type DestinoCobranza,
  type MetodoCobranza,
} from './reglas-destino';
import { esFechaValida } from './reglas-saldo';
import { TesoreriaRepository } from './tesoreria.repository';
import { TesoreriaService } from './tesoreria.service';

export interface DestinosSucursal {
  sucursalId: string;
  sucursalCodigo: string;
  sucursalNombre: string;
  vigentes: Record<MetodoCobranza, DestinoCobranza | null>;
  historial: DestinoCobranza[];
}

@Injectable()
export class DestinosService {
  constructor(
    private readonly repo: DestinosRepository,
    private readonly tesoreriaRepo: TesoreriaRepository,
    private readonly tesoreria: TesoreriaService,
  ) {}

  async listar(
    usuarioId: string,
    q: ListarDestinosDto,
  ): Promise<DestinosSucursal[]> {
    const usuario = await this.tesoreria.usuario(usuarioId);
    const alcance = resolverAlcance(
      usuario.codigo,
      normalizarSucursalPedida(q.sucursal),
    );
    const sucursales = await this.repo.sucursales(
      alcance.tipo === 'todas' ? null : alcance.codigo,
    );
    const destinos = await this.repo.listar(sucursales.map((s) => s.id));
    const hoy = await this.tesoreriaRepo.hoyEnTijuana();
    return sucursales.map((s) => {
      const vigentes = Object.fromEntries(
        METODOS_COBRANZA.map((m) => [m, destinoDe(s.id, m, hoy, destinos)]),
      ) as Record<MetodoCobranza, DestinoCobranza | null>;
      return {
        sucursalId: s.id,
        sucursalCodigo: s.codigo,
        sucursalNombre: s.nombre,
        vigentes,
        historial: destinos.filter((d) => d.sucursalId === s.id),
      };
    });
  }

  async guardar(
    usuarioId: string,
    dto: GuardarDestinoDto,
  ): Promise<DestinoCobranza> {
    if (!esFechaValida(dto.desde)) {
      throw new BadRequestException('La fecha "desde" no es válida.');
    }
    if (dto.desde > (await this.tesoreriaRepo.hoyEnTijuana())) {
      throw new BadRequestException('La fecha "desde" no puede ser futura.');
    }
    const usuario = await this.tesoreria.usuario(usuarioId);
    if (usuario.id !== null && usuario.id !== dto.sucursalId) {
      throw new ForbiddenException('No tienes acceso a esa sucursal.');
    }
    const cuenta = await this.tesoreria.cuentaVisible(usuarioId, dto.cuentaId);
    if (cuenta.sucursalId !== null && cuenta.sucursalId !== dto.sucursalId) {
      throw new BadRequestException(
        'La cuenta tiene que ser de esa sucursal o general.',
      );
    }
    try {
      await this.repo.guardar(dto, usuarioId);
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        (error as { code?: unknown }).code === '23503'
      ) {
        throw new BadRequestException('La sucursal no existe.');
      }
      throw error;
    }
    const guardado = (await this.repo.listar([dto.sucursalId])).find(
      (d) => d.metodo === dto.metodo && d.desde === dto.desde,
    );
    if (!guardado)
      throw new BadRequestException('No se pudo guardar el destino.');
    return guardado;
  }
}
