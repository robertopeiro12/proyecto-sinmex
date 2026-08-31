import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { resolverAlcance, type Alcance } from '../sucursales/alcance-sucursal';
import {
  ClientesRepository,
  type ClienteDetalle,
  type ClienteResumen,
  type TipoFiltro,
} from './clientes.repository';

/** Cualquier valor que no sea 'cliente'/'prospecto' se trata como "todos" (D7 del spec): es un filtro de exhibicion, sin implicacion de seguridad. */
export function normalizarTipoPedido(crudo: string | undefined): TipoFiltro {
  return crudo === 'cliente' || crudo === 'prospecto' ? crudo : 'todos';
}

@Injectable()
export class ClientesService {
  constructor(private readonly repo: ClientesRepository) {}

  async listar(
    usuarioId: string,
    sucursalPedida: string | null,
    tipo: TipoFiltro,
  ): Promise<ClienteResumen[]> {
    const alcance = await this.alcanceDe(usuarioId, sucursalPedida);
    return alcance.tipo === 'todas'
      ? this.repo.listar(tipo)
      : this.repo.listarPorCodigoSucursal(alcance.codigo, tipo);
  }

  async obtener(usuarioId: string, id: string): Promise<ClienteDetalle> {
    const cliente = await this.repo.obtener(id);
    if (!cliente) {
      throw new NotFoundException('No existe ese cliente.');
    }

    // Misma doctrina que VehiculosService.editar (T-11): el alcance se
    // compara contra la sucursal del cliente YA LEIDO, no contra un query
    // param -- aqui el hecho es lo que ya existe en la base.
    const alcance = await this.alcanceDe(usuarioId, null);
    if (alcance.tipo === 'una' && alcance.codigo !== cliente.sucursalCodigo) {
      throw new ForbiddenException('No tienes acceso a esa sucursal.');
    }

    return cliente;
  }

  protected async alcanceDe(
    usuarioId: string,
    sucursalPedida: string | null,
  ): Promise<Alcance> {
    const fila = await this.repo.buscarSucursalUsuario(usuarioId);
    if (!fila) {
      throw new UnauthorizedException('Sesion invalida.');
    }
    return resolverAlcance(fila.codigo, sucursalPedida);
  }
}
