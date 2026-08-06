import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { resolverAlcance, type Alcance } from './alcance-sucursal';
import { SucursalesRepository, type Sucursal } from './sucursales.repository';
import type { CrearSucursalDto } from './dto/crear-sucursal.dto';
import type { EditarSucursalDto } from './dto/editar-sucursal.dto';

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

  async editar(
    usuarioId: string,
    id: string,
    dto: EditarSucursalDto,
  ): Promise<Sucursal> {
    // El 400 va ANTES de tocar la base: un PATCH sin cambios no es un fallo
    // del servidor ni justifica una consulta, es un cuerpo mal armado.
    if (dto.nombre === undefined && dto.activa === undefined) {
      throw new BadRequestException('No hay nada que actualizar.');
    }

    const sucursal = await this.repo.buscarPorId(id);
    if (!sucursal) {
      throw new NotFoundException('No existe esa sucursal.');
    }

    // El alcance manda igual en escritura que en lectura (D3). Se compara
    // contra la sucursal YA leida y no contra el query param: aqui el objeto
    // que se va a modificar es el hecho, no lo que el cliente diga.
    const alcance = await this.alcanceDe(usuarioId, null);
    if (alcance.tipo === 'una' && alcance.codigo !== sucursal.codigo) {
      throw new ForbiddenException('No tienes acceso a esa sucursal.');
    }

    const cambios: { nombre?: string; activa?: boolean } = {};
    if (dto.nombre !== undefined) {
      cambios.nombre = dto.nombre;
    }
    if (dto.activa !== undefined) {
      cambios.activa = dto.activa;
    }

    return this.repo.actualizar(id, cambios);
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
