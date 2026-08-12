import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ReconciliacionInvalida,
  reconciliarPresentaciones,
  type PlanPresentaciones,
} from './reconciliar-presentaciones';
import { ProductosRepository, type Producto } from './productos.repository';
import type { CrearProductoDto } from './dto/crear-producto.dto';
import type { EditarProductoDto } from './dto/editar-producto.dto';

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

/**
 * El driver `pg` expone en `error.constraint` el nombre del indice que violo
 * el unique. En `crear()` solo puede dispararse `uq_producto_nombre` (no hay
 * nada existente contra que chocar en volumen todavia), pero en `editar()`
 * tambien puede dispararse `uq_presentacion_volumen` -- por ejemplo, renombrar
 * una presentacion al volumen que ya tiene una hermana suya que no forma parte
 * de este guardado. Sin distinguirlos, ese caso salia como "nombre repetido",
 * un mensaje enganoso que apunta al campo equivocado.
 */
function nombreDelIndice(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('constraint' in error)) {
    return undefined;
  }
  const valor = (error as { constraint?: unknown }).constraint;
  return typeof valor === 'string' ? valor : undefined;
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

  async editar(id: string, dto: EditarProductoDto): Promise<Producto> {
    // Lectura FUERA de la transaccion que mas abajo aplica el plan derivado de
    // ella: entre este read y el write, una edicion concurrente podria cambiar
    // las presentaciones y dejar el plan desactualizado (read-modify-write
    // clasico). En esta pantalla de un solo admin el modo de fallo es
    // "gana el ultimo que guarda", no corrupcion, asi que no se restructura
    // aqui. Si un ticket futuro copia este patron de transaccion (T-16 venta,
    // T-18 precios) para algo con escritores concurrentes, el read-y-plan
    // deberia ir DENTRO de la transaccion, no antes.
    const producto = await this.repo.buscarPorId(id);
    if (!producto) {
      throw new NotFoundException('No existe ese producto.');
    }

    let plan: PlanPresentaciones;
    try {
      plan = reconciliarPresentaciones(
        producto.presentaciones,
        dto.presentaciones,
      );
    } catch (error) {
      // Lista vacia, id ajeno o volumen repetido: los tres son un cuerpo mal
      // armado, no un choque con lo que ya existe. 400, no 409.
      if (error instanceof ReconciliacionInvalida) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }

    const cambios: { nombre: string; activo?: boolean } = {
      nombre: dto.nombre,
    };
    if (dto.activo !== undefined) {
      cambios.activo = dto.activo;
    }

    try {
      return await this.repo.actualizar(id, cambios, plan);
    } catch (error) {
      if (esDuplicado(error)) {
        if (nombreDelIndice(error) === 'uq_presentacion_volumen') {
          throw new ConflictException(
            'Ya existe una presentación con ese volumen para este producto.',
          );
        }
        // `uq_producto_nombre`, o cualquier 23505 sin `constraint` reconocido:
        // se mantiene el mensaje de nombre como respaldo, que es la causa mas
        // comun con diferencia.
        throw new ConflictException(
          `Ya existe un producto llamado "${dto.nombre}".`,
        );
      }
      throw error;
    }
  }
}
