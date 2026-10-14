import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { resolverAlcance, type Alcance } from '../sucursales/alcance-sucursal';
import type {
  CrearPromocionDto,
  EditarPromocionDto,
} from './dto/promocion.dto';
import { textoPromocion } from './promociones-texto';
import {
  PromocionesRepository,
  type Promocion,
} from './promociones.repository';
import {
  coincidenEnProducto,
  problemaDeRegla,
  type Cobertura,
  type ReglaCompleta,
} from './reglas-promocion';

export const MOTIVO_PROMOCION_INEXISTENTE = 'No existe esa promoción.';
export const MOTIVO_CLIENTE_INEXISTENTE = 'No existe ese cliente.';
const MOTIVO_SUCURSAL_INEXISTENTE = 'No existe esa sucursal.';

function cobertura(p: Pick<Promocion, 'compraProductoCubierto'>): Cobertura {
  return p.compraProductoCubierto === null
    ? 'todos'
    : new Set([p.compraProductoCubierto]);
}

/** Promociones por regla (T-74). Toda lectura y escritura pasa por el alcance del usuario. */
@Injectable()
export class PromocionesService {
  constructor(private readonly repo: PromocionesRepository) {}

  /**
   * `GET /promociones`. Sin `clienteId`: las generales (todos + prospecto) de la
   * sucursal pedida (un General sin sucursal: 400, la pantalla siempre manda
   * una). Con `clienteId`: las propias del cliente y las de `todos` de su
   * sucursal, con `desplazada` (D5).
   */
  async listar(
    usuarioId: string,
    sucursalPedida: string | null,
    clienteId: string | null,
  ): Promise<Promocion[]> {
    const alcance = await this.alcanceDe(usuarioId, sucursalPedida);
    if (clienteId !== null) {
      const cliente = await this.repo.clienteVivo(clienteId);
      // 404 y no 403: no se confirma que un cliente de otra sucursal exista.
      if (
        !cliente ||
        (alcance.tipo === 'una' && alcance.codigo !== cliente.sucursalCodigo)
      ) {
        throw new NotFoundException(MOTIVO_CLIENTE_INEXISTENTE);
      }
      const filas = (
        await this.repo.deCliente(cliente.id, cliente.sucursalId)
      ).map((f) => this.conTexto(f));
      const propias = filas.filter(
        (f) => f.audiencia === 'cliente' && f.activo,
      );
      return filas.map((f) =>
        f.audiencia === 'todos'
          ? {
              ...f,
              desplazada: propias.some((p) =>
                coincidenEnProducto(cobertura(p), cobertura(f)),
              ),
            }
          : f,
      );
    }
    if (alcance.tipo === 'todas') {
      throw new BadRequestException(
        'Elige una sucursal para ver sus promociones.',
      );
    }
    const [sucursal] = await this.repo.sucursalesActivas(alcance.codigo);
    if (!sucursal) throw new NotFoundException(MOTIVO_SUCURSAL_INEXISTENTE);
    return (await this.repo.generales(sucursal.id)).map((f) =>
      this.conTexto(f),
    );
  }

  /** `POST /promociones`. Devuelve las creadas (una por sucursal con `'todas'`). */
  async crear(usuarioId: string, dto: CrearPromocionDto): Promise<Promocion[]> {
    const regla = this.aRegla(dto);
    // Los objetivos se comprueban antes de abrir la transaccion: el 404 sale limpio.
    await this.exigirObjetivos(regla);
    const alcance = await this.alcanceDe(usuarioId, null);

    let sucursales: string[];
    if (regla.audiencia === 'cliente') {
      const cliente = await this.repo.clienteVivo(regla.clienteId as string);
      if (
        !cliente ||
        (alcance.tipo === 'una' && alcance.codigo !== cliente.sucursalCodigo)
      ) {
        throw new NotFoundException(MOTIVO_CLIENTE_INEXISTENTE);
      }
      sucursales = [cliente.sucursalId];
    } else if (dto.sucursalId === 'todas') {
      // Un usuario atado a una sucursal solo crea en la suya, aunque pida 'todas'.
      sucursales = (
        await this.repo.sucursalesActivas(
          alcance.tipo === 'una' ? alcance.codigo : null,
        )
      ).map((s) => s.id);
    } else if (alcance.tipo === 'una') {
      const [propia] = await this.repo.sucursalesActivas(alcance.codigo);
      if (!propia) throw new NotFoundException(MOTIVO_SUCURSAL_INEXISTENTE);
      sucursales = [propia.id];
    } else {
      if (!dto.sucursalId) {
        throw new BadRequestException(
          'Indica a qué sucursal pertenece la promoción.',
        );
      }
      const existe = (await this.repo.sucursalesActivas(null)).some(
        (s) => s.id === dto.sucursalId,
      );
      if (!existe) throw new NotFoundException(MOTIVO_SUCURSAL_INEXISTENTE);
      sucursales = [dto.sucursalId];
    }

    const ids = await this.repo.enTransaccion((trx) =>
      this.repo.crear(
        sucursales.map((sucursalId) => ({ ...regla, sucursalId })),
        trx,
      ),
    );
    return Promise.all(ids.map((id) => this.obtener(id)));
  }

  /** `PATCH /promociones/:id`: la regla completa y `activo`. Audiencia, cliente y sucursal no cambian. */
  async editar(
    usuarioId: string,
    id: string,
    dto: EditarPromocionDto,
  ): Promise<Promocion> {
    const actual = await this.repo.buscar(id);
    if (!actual) throw new NotFoundException(MOTIVO_PROMOCION_INEXISTENTE);
    const alcance = await this.alcanceDe(usuarioId, null);
    if (alcance.tipo === 'una' && alcance.codigo !== actual.sucursalCodigo) {
      throw new ForbiddenException('No tienes acceso a esa sucursal.');
    }
    const regla = this.aRegla({
      ...dto,
      audiencia: actual.audiencia,
      clienteId: actual.clienteId ?? undefined,
    });
    await this.exigirObjetivos(regla);
    await this.repo.actualizar(id, { ...regla, activo: dto.activo });
    return this.obtener(id);
  }

  private async obtener(id: string): Promise<Promocion> {
    const fila = await this.repo.buscar(id);
    if (!fila) throw new NotFoundException(MOTIVO_PROMOCION_INEXISTENTE);
    return this.conTexto(fila);
  }

  private conTexto(f: Omit<Promocion, 'texto'>): Promocion {
    return {
      ...f,
      texto: textoPromocion(f, {
        compra: f.compraNombre,
        regalo: f.regaloNombre,
      }),
    };
  }

  /** Normaliza el DTO plano y valida la coherencia (400 con mensaje). */
  private aRegla(dto: Omit<CrearPromocionDto, 'sucursalId'>): ReglaCompleta {
    const regla: ReglaCompleta = {
      audiencia: dto.audiencia,
      clienteId: dto.clienteId ?? null,
      compraTipo: dto.compraTipo,
      compraProductoId: dto.compraProductoId ?? null,
      compraPresentacionId: dto.compraPresentacionId ?? null,
      compraCantidad: dto.compraCantidad,
      regaloTipo: dto.regaloTipo,
      regaloProductoId: dto.regaloProductoId ?? null,
      regaloPresentacionId: dto.regaloPresentacionId ?? null,
      regaloCantidad: dto.regaloCantidad,
      seRepite: dto.seRepite,
    };
    const problema = problemaDeRegla(regla);
    if (problema) throw new BadRequestException(problema);
    return regla;
  }

  /** Los productos y presentaciones de la regla tienen que existir (404 con mensaje). */
  private async exigirObjetivos(regla: ReglaCompleta): Promise<void> {
    for (const [id, que] of [
      [regla.compraProductoId, 'el producto que se compra'],
      [regla.regaloProductoId, 'el producto que se regala'],
    ] as const) {
      if (id && !(await this.repo.productoVivo(id))) {
        throw new NotFoundException(`No existe ${que}.`);
      }
    }
    for (const [id, que] of [
      [regla.compraPresentacionId, 'la presentación que se compra'],
      [regla.regaloPresentacionId, 'la presentación que se regala'],
    ] as const) {
      if (id && !(await this.repo.presentacionViva(id))) {
        throw new NotFoundException(`No existe ${que}.`);
      }
    }
  }

  private async alcanceDe(
    usuarioId: string,
    sucursalPedida: string | null,
  ): Promise<Alcance> {
    const fila = await this.repo.buscarSucursalUsuario(usuarioId);
    if (!fila) throw new UnauthorizedException('Sesión inválida.');
    return resolverAlcance(fila.codigo, sucursalPedida);
  }
}
