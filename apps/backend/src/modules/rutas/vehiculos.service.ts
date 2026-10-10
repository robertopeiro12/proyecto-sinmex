import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { resolverAlcance, type Alcance } from '../sucursales/alcance-sucursal';
import { VehiculosRepository, type Vehiculo } from './vehiculos.repository';
import type { CrearVehiculoDto } from './dto/crear-vehiculo.dto';
import type { EditarVehiculoDto } from './dto/editar-vehiculo.dto';

/**
 * `23505` es unique_violation. Se mira DESPUES del insert en vez de consultar
 * antes si el nombre existe: una consulta previa deja una ventana entre el
 * SELECT y el INSERT en la que otra peticion puede meter el mismo nombre, y el
 * unique de la base es quien de verdad decide. Mismo criterio que T-09 y T-10.
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
 * el unique. Antes de T-68 `vehiculo` tenia un solo unique
 * (`uq_vehiculo_nombre_sucursal`); ahora tambien puede chocar
 * `uq_vehiculo_placas`, y sin distinguirlos el administrador veria "ya existe
 * un vehiculo llamado X" cuando el problema real son las placas repetidas.
 * Mismo patron que `nombreDelIndice` en `productos.service.ts` (T-10).
 */
function nombreDelIndice(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('constraint' in error)) {
    return undefined;
  }
  const valor = (error as { constraint?: unknown }).constraint;
  return typeof valor === 'string' ? valor : undefined;
}

@Injectable()
export class VehiculosService {
  constructor(private readonly repo: VehiculosRepository) {}

  async listar(
    usuarioId: string,
    sucursalPedida: string | null,
  ): Promise<Vehiculo[]> {
    const alcance = await this.alcanceDe(usuarioId, sucursalPedida);
    return alcance.tipo === 'todas'
      ? this.repo.listar()
      : this.repo.listarPorCodigoSucursal(alcance.codigo);
  }

  /**
   * D3 — el cliente propone, el servidor dispone. La sucursal sale del alcance
   * del usuario, no del cuerpo de la peticion:
   *   - atado a una sucursal -> la suya, y el `sucursalId` que mande se IGNORA
   *   - General               -> tiene que mandarlo; si no llega, es 400
   */
  async crear(usuarioId: string, dto: CrearVehiculoDto): Promise<Vehiculo> {
    const fila = await this.repo.buscarSucursalUsuario(usuarioId);
    if (!fila) {
      throw new UnauthorizedException('Sesion invalida.');
    }

    const sucursalId = fila.id ?? dto.sucursalId;
    if (!sucursalId) {
      throw new BadRequestException(
        'Indica a qué sucursal pertenece el vehículo.',
      );
    }

    try {
      return await this.repo.crear(
        dto.nombre,
        dto.placas,
        dto.kmInicial,
        sucursalId,
      );
    } catch (error) {
      if (esDuplicado(error)) {
        if (nombreDelIndice(error) === 'uq_vehiculo_placas') {
          throw new ConflictException(
            `Ya existe un vehículo con las placas "${dto.placas}".`,
          );
        }
        throw new ConflictException(
          `Ya existe un vehículo llamado "${dto.nombre}" en esa sucursal.`,
        );
      }
      throw error;
    }
  }

  async editar(
    usuarioId: string,
    id: string,
    dto: EditarVehiculoDto,
  ): Promise<Vehiculo> {
    // El 400 va ANTES de tocar la base: un PATCH sin cambios no es un fallo del
    // servidor ni justifica una consulta, es un cuerpo mal armado.
    if (
      dto.nombre === undefined &&
      dto.placas === undefined &&
      dto.kmInicial === undefined &&
      dto.activo === undefined
    ) {
      throw new BadRequestException('No hay nada que actualizar.');
    }

    const vehiculo = await this.repo.buscarPorId(id);
    if (!vehiculo) {
      throw new NotFoundException('No existe ese vehículo.');
    }

    // El alcance manda igual en escritura que en lectura (D3). Se compara contra
    // la sucursal del vehiculo YA LEIDO y no contra el query param: aqui el
    // objeto que se va a modificar es el hecho, no lo que el cliente diga.
    const alcance = await this.alcanceDe(usuarioId, null);
    if (alcance.tipo === 'una' && alcance.codigo !== vehiculo.sucursalCodigo) {
      throw new ForbiddenException('No tienes acceso a esa sucursal.');
    }

    const cambios: {
      nombre?: string;
      placas?: string;
      km_inicial?: number;
      activo?: boolean;
    } = {};
    if (dto.nombre !== undefined) {
      cambios.nombre = dto.nombre;
    }
    if (dto.placas !== undefined) {
      cambios.placas = dto.placas;
    }
    if (dto.kmInicial !== undefined) {
      cambios.km_inicial = dto.kmInicial;
    }
    if (dto.activo !== undefined) {
      cambios.activo = dto.activo;
    }

    try {
      return await this.repo.actualizar(id, cambios);
    } catch (error) {
      if (esDuplicado(error)) {
        if (nombreDelIndice(error) === 'uq_vehiculo_placas') {
          throw new ConflictException(
            `Ya existe un vehículo con las placas "${dto.placas ?? vehiculo.placas}".`,
          );
        }
        throw new ConflictException(
          `Ya existe un vehículo llamado "${dto.nombre ?? vehiculo.nombre}" en esa sucursal.`,
        );
      }
      throw error;
    }
  }

  /**
   * El JWT solo lleva `sub` y `tipo` (decision de T-06), asi que la sucursal del
   * usuario no viaja en el token y hay que consultarla. Misma forma que
   * SucursalesService.alcanceDe de T-09.
   */
  private async alcanceDe(
    usuarioId: string,
    sucursalPedida: string | null,
  ): Promise<Alcance> {
    const fila = await this.repo.buscarSucursalUsuario(usuarioId);
    // El guard valido la FIRMA del token, no que el usuario siga existiendo.
    // Un token vivo de alguien dado de baja llega hasta aqui.
    if (!fila) {
      throw new UnauthorizedException('Sesion invalida.');
    }
    return resolverAlcance(fila.codigo, sucursalPedida);
  }
}
