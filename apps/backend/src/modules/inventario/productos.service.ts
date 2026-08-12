import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import {
  ReconciliacionInvalida,
  reconciliarPresentaciones,
  type PlanPresentaciones,
} from './reconciliar-presentaciones';
import { ProductosRepository, type Producto } from './productos.repository';
import type { CrearProductoDto } from './dto/crear-producto.dto';

/**
 * `23505` es unique_violation. Se mira DESPUES del insert en vez de consultar
 * antes si el nombre existe: una consulta previa deja una ventana entre el
 * SELECT y el INSERT, y el unique de la base es quien de verdad decide. Mismo
 * criterio que SucursalesService (T-09).
 */
function esDuplicado(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === '23505'
  );
}

@Injectable()
export class ProductosService {
  constructor(private readonly repo: ProductosRepository) {}

  async listar(): Promise<Producto[]> {
    return this.repo.listar();
  }

  async crear(dto: CrearProductoDto): Promise<Producto> {
    // El alta es el caso degenerado de la reconciliacion: no hay nada
    // existente, asi que todo lo pedido es un alta. Se reusa la misma funcion
    // en vez de escribir una segunda validacion de volumenes repetidos, que es
    // como las dos acaban divergiendo.
    let plan: PlanPresentaciones;
    try {
      plan = reconciliarPresentaciones([], dto.presentaciones);
    } catch (error) {
      if (error instanceof ReconciliacionInvalida) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }

    try {
      return await this.repo.crear(
        dto.nombre,
        plan.insertar.map((p) => p.volumen),
      );
    } catch (error) {
      if (esDuplicado(error)) {
        throw new ConflictException(
          `Ya existe un producto llamado "${dto.nombre}".`,
        );
      }
      throw error;
    }
  }
}
