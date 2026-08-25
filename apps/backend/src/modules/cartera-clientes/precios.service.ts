import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { resolverAlcance } from '../sucursales/alcance-sucursal';
import {
  PreciosRepository,
  type ListaPrecio,
  type PrecioVigente,
} from './precios.repository';
import type { ActualizarPrecioDto } from './dto/actualizar-precio.dto';

/** `23503` es foreign_key_violation: presentacionId, listaPrecioId o sucursalId no existen. */
function esViolacionFk(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === '23503'
  );
}

@Injectable()
export class PreciosService {
  constructor(private readonly repo: PreciosRepository) {}

  async listarListas(): Promise<ListaPrecio[]> {
    return this.repo.listarListas();
  }

  async listarVigentes(
    usuarioId: string,
    sucursalPedida: string | null,
  ): Promise<PrecioVigente[]> {
    const fila = await this.repo.buscarSucursalUsuario(usuarioId);
    if (!fila) {
      throw new UnauthorizedException('Sesion invalida.');
    }
    const alcance = resolverAlcance(fila.codigo, sucursalPedida);
    // A diferencia de vehiculos (que puede listar "todas" en una tabla
    // plana con columna Sucursal), la matriz de precios pinta UNA sucursal a
    // la vez (D7 del spec): no hay una forma sensata de responder "todas".
    if (alcance.tipo === 'todas') {
      throw new BadRequestException(
        'Elige una sucursal: el precio varía por sucursal.',
      );
    }
    return this.repo.listarVigentes(alcance.codigo);
  }

  /**
   * A diferencia de la edicion de vehiculo (T-11), aqui no hay una fila
   * existente que leer para comparar sucursales: el cuerpo del PATCH siempre
   * trae un `sucursalId` concreto (D del spec, tabla de Endpoints), y lo que
   * se valida es que ese id sea el que le toca al usuario -- comparando ids
   * directamente, sin pasar por `resolverAlcance()` (aqui no hay "todas" que
   * resolver).
   */
  async actualizar(
    usuarioId: string,
    dto: ActualizarPrecioDto,
  ): Promise<PrecioVigente> {
    const fila = await this.repo.buscarSucursalUsuario(usuarioId);
    if (!fila) {
      throw new UnauthorizedException('Sesion invalida.');
    }
    if (fila.id !== null && fila.id !== dto.sucursalId) {
      throw new ForbiddenException('No tienes acceso a esa sucursal.');
    }

    try {
      return await this.repo.upsert(dto);
    } catch (error) {
      if (esViolacionFk(error)) {
        throw new NotFoundException('Alguno de los datos enviados no existe.');
      }
      throw error;
    }
  }
}
