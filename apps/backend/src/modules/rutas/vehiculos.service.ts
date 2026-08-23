import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { resolverAlcance, type Alcance } from '../sucursales/alcance-sucursal';
import { VehiculosRepository, type Vehiculo } from './vehiculos.repository';
import type { CrearVehiculoDto } from './dto/crear-vehiculo.dto';

/**
 * `23505` es unique_violation. Se mira DESPUES del insert en vez de consultar
 * antes si el nombre existe: una consulta previa deja una ventana entre el
 * SELECT y el INSERT en la que otra peticion puede meter el mismo nombre, y el
 * unique de la base es quien de verdad decide. Mismo criterio que T-09 y T-10.
 *
 * Aqui no hace falta distinguir POR indice (como si hizo T-10 con
 * `nombreDelIndice`): `vehiculo` tiene un solo unique, asi que cualquier 23505
 * de esta tabla es el nombre repetido.
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
      return await this.repo.crear(dto.nombre, dto.kmInicial, sucursalId);
    } catch (error) {
      if (esDuplicado(error)) {
        throw new ConflictException(
          `Ya existe un vehículo llamado "${dto.nombre}" en esa sucursal.`,
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
