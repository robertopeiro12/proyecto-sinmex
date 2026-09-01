import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { resolverAlcance, type Alcance } from '../sucursales/alcance-sucursal';
import { esViolacionFk } from '../../database/errores-postgres';
import { reconciliarPromocionProductos } from './reconciliar-promocion-productos';
import type { CrearClienteDto } from './dto/crear-cliente.dto';
import type { EditarClienteDto } from './dto/editar-cliente.dto';
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

  async crear(
    usuarioId: string,
    dto: CrearClienteDto,
  ): Promise<ClienteDetalle> {
    const fila = await this.repo.buscarSucursalUsuario(usuarioId);
    if (!fila) {
      throw new UnauthorizedException('Sesion invalida.');
    }

    // D6: la sucursal sale del alcance, no del cuerpo.
    const sucursalId = fila.id ?? dto.sucursalId;
    if (!sucursalId) {
      throw new BadRequestException(
        'Indica a qué sucursal pertenece el cliente.',
      );
    }

    const plan = reconciliarPromocionProductos(
      dto.promocion,
      [],
      dto.productosPromocion,
    );

    // El alta inserta los overrides en un solo `insertInto(...).values([...])`
    // (D4 del spec): dos entradas con el mismo `presentacionId` chocarian con
    // `uq_cliente_precio_vigencia` (23505). El formulario no puede producir
    // esto (usa un Map por presentacion), pero un caller de la API si -- se
    // deduplica aqui quedandose con la ULTIMA entrada por presentacion, mismo
    // criterio "gana la ultima" que `reconciliarPromocionProductos` aplica a
    // `productosPromocion` via `Set`.
    const overridesUnicos = [
      ...new Map(
        dto.overridesPrecio.map((o) => [o.presentacionId, o]),
      ).values(),
    ];

    try {
      return await this.repo.crear(
        {
          nombre: dto.nombre,
          domicilio: dto.domicilio,
          telefono: dto.telefono,
          encargado: dto.encargado ?? null,
          factura: dto.factura,
          tipo: dto.tipo,
          tipo_negocio_id: dto.tipoNegocioId ?? null,
          lista_precio_id: dto.listaPrecioId,
          pct_comision: dto.pctComision ?? null,
          promocion: dto.promocion,
          plazo_credito_dias: dto.plazoCreditoDias ?? null,
          lat: dto.lat ?? null,
          lng: dto.lng ?? null,
          comentarios: dto.comentarios ?? null,
          sucursal_id: sucursalId,
        },
        plan.insertar,
        // En el alta, un override con `precio: null` no tiene nada que
        // limpiar (no hay fila previa) -- se descarta antes de llegar al
        // repositorio.
        overridesUnicos.filter(
          (o): o is { presentacionId: string; precio: number } =>
            o.precio !== null,
        ),
        dto.vigenteDesde,
      );
    } catch (error) {
      if (esViolacionFk(error)) {
        throw new NotFoundException('Alguno de los datos enviados no existe.');
      }
      throw error;
    }
  }

  async editar(
    usuarioId: string,
    id: string,
    dto: EditarClienteDto,
  ): Promise<ClienteDetalle> {
    const cliente = await this.repo.obtener(id);
    if (!cliente) {
      throw new NotFoundException('No existe ese cliente.');
    }

    const alcance = await this.alcanceDe(usuarioId, null);
    if (alcance.tipo === 'una' && alcance.codigo !== cliente.sucursalCodigo) {
      throw new ForbiddenException('No tienes acceso a esa sucursal.');
    }

    const plan = reconciliarPromocionProductos(
      dto.promocion,
      cliente.productosPromocion,
      dto.productosPromocion,
    );

    try {
      return await this.repo.actualizar(
        id,
        {
          nombre: dto.nombre,
          domicilio: dto.domicilio,
          telefono: dto.telefono,
          encargado: dto.encargado ?? null,
          factura: dto.factura,
          tipo_negocio_id: dto.tipoNegocioId ?? null,
          lista_precio_id: dto.listaPrecioId,
          pct_comision: dto.pctComision ?? null,
          promocion: dto.promocion,
          plazo_credito_dias: dto.plazoCreditoDias ?? null,
          lat: dto.lat ?? null,
          lng: dto.lng ?? null,
          comentarios: dto.comentarios ?? null,
        },
        plan,
        dto.overridesPrecio,
        dto.vigenteDesde,
      );
    } catch (error) {
      if (esViolacionFk(error)) {
        throw new NotFoundException('Alguno de los datos enviados no existe.');
      }
      throw error;
    }
  }

  async eliminar(usuarioId: string, id: string): Promise<void> {
    const cliente = await this.repo.obtener(id);
    if (!cliente) {
      throw new NotFoundException('No existe ese cliente.');
    }

    const alcance = await this.alcanceDe(usuarioId, null);
    if (alcance.tipo === 'una' && alcance.codigo !== cliente.sucursalCodigo) {
      throw new ForbiddenException('No tienes acceso a esa sucursal.');
    }

    await this.repo.eliminar(id);
  }

  /**
   * Un solo sentido: Prospecto -> Cliente, nunca al reves (respuesta directa
   * de Roberto/el cliente: la conversion la decide un administrador a mano
   * desde el Portal, no algo automatico ni bidireccional).
   */
  async convertirACliente(
    usuarioId: string,
    id: string,
  ): Promise<ClienteDetalle> {
    const cliente = await this.repo.obtener(id);
    if (!cliente) {
      throw new NotFoundException('No existe ese cliente.');
    }

    const alcance = await this.alcanceDe(usuarioId, null);
    if (alcance.tipo === 'una' && alcance.codigo !== cliente.sucursalCodigo) {
      throw new ForbiddenException('No tienes acceso a esa sucursal.');
    }

    if (cliente.tipo === 'cliente') {
      throw new ConflictException('Ya es cliente.');
    }

    return this.repo.convertirACliente(id);
  }

  private async alcanceDe(
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
