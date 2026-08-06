import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { resolverAlcance, type Alcance } from './alcance-sucursal';
import { SucursalesRepository, type Sucursal } from './sucursales.repository';
import type { CrearSucursalDto } from './dto/crear-sucursal.dto';

/**
 * `23505` es unique_violation en Postgres. Se mira el error DESPUES del insert
 * en vez de consultar antes si el codigo existe: una consulta previa deja una
 * ventana entre el SELECT y el INSERT en la que otra peticion puede meter el
 * mismo codigo, y el unique de la base es quien de verdad decide.
 */
function esCodigoDuplicado(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === '23505'
  );
}

@Injectable()
export class SucursalesService {
  constructor(private readonly repo: SucursalesRepository) {}

  async listar(
    usuarioId: string,
    sucursalPedida: string | null,
  ): Promise<Sucursal[]> {
    const alcance = await this.alcanceDe(usuarioId, sucursalPedida);
    return alcance.tipo === 'todas'
      ? this.repo.listar()
      : this.repo.listarPorCodigo(alcance.codigo);
  }

  /**
   * Crear una sucursal no ocurre "dentro de" ninguna sucursal, asi que no hay
   * alcance que aplicar: hoy cualquier usuario con sesion puede hacerlo. Quien
   * deberia poder es cosa del permiso `sucursal.gestionar` en T-08 (ver el
   * spec, seccion Endpoints).
   */
  async crear(dto: CrearSucursalDto): Promise<Sucursal> {
    try {
      return await this.repo.crear(dto.codigo, dto.nombre);
    } catch (error) {
      if (esCodigoDuplicado(error)) {
        throw new ConflictException(
          `Ya existe una sucursal con el código ${dto.codigo}.`,
        );
      }
      throw error;
    }
  }

  /**
   * El JWT solo lleva `sub` y `tipo` (decision de T-06), asi que la sucursal
   * del usuario no viaja en el token y hay que consultarla. Es una lectura por
   * PK con un join; meterla en el token o cachearla corresponde a T-08, cuando
   * el guard tenga que cargar tambien los permisos y valga la pena resolver el
   * problema una sola vez para todo.
   */
  private async alcanceDe(
    usuarioId: string,
    sucursalPedida: string | null,
  ): Promise<Alcance> {
    const fila = await this.repo.buscarSucursalDeUsuario(usuarioId);
    // El guard valido la FIRMA del token, no que el usuario siga existiendo.
    // Un token vivo de alguien dado de baja llega hasta aqui.
    if (!fila) {
      throw new UnauthorizedException('Sesion invalida.');
    }
    return resolverAlcance(fila.codigo, sucursalPedida);
  }
}
