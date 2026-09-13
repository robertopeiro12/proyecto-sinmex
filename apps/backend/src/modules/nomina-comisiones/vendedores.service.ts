import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { resolverAlcance, type Alcance } from '../sucursales/alcance-sucursal';
import { VendedoresRepository, type Vendedor } from './vendedores.repository';
import {
  esViolacionFk,
  esViolacionUnicidad,
} from '../../database/errores-postgres';
import { PasswordService } from '../auth/password.service';
import { candidatosDeSegmento } from '../sincronizacion/segmento-vendedor';
import type { CrearVendedorDto } from './dto/crear-vendedor.dto';

/**
 * El driver `pg` expone en `error.constraint` el indice que violo el unique.
 * `vendedor` tiene DOS uniques que un solo INSERT puede disparar
 * (`uq_vendedor_login` de la Task 1 y `uq_vendedor_folio_segmento` de la
 * Task 2), asi que hay que distinguirlos -- mismo patron que
 * `nombreDelIndice()` de `ProductosService.editar()` (T-10), que distingue
 * `uq_producto_nombre` de `uq_presentacion_volumen`.
 */
function nombreDelIndice(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('constraint' in error)) {
    return undefined;
  }
  const valor = (error as { constraint?: unknown }).constraint;
  return typeof valor === 'string' ? valor : undefined;
}

@Injectable()
export class VendedoresService {
  constructor(
    private readonly repo: VendedoresRepository,
    private readonly password: PasswordService,
  ) {}

  async listar(
    usuarioId: string,
    sucursalPedida: string | null,
  ): Promise<Vendedor[]> {
    const alcance = await this.alcanceDe(usuarioId, sucursalPedida);
    return alcance.tipo === 'todas'
      ? this.repo.listar()
      : this.repo.listarPorCodigoSucursal(alcance.codigo);
  }

  /**
   * D6 del spec (enmienda de ADR-0007) -- SIN consulta previa: se calcula el
   * PRIMER candidato de `candidatosDeSegmento()` (inicial + inicial de
   * apellido, la regla del ADR) y se intenta el insert directo. No se camina
   * la lista de alternativas: si ya esta tomado en esta sucursal, se
   * RECHAZA el alta -- es el cambio de estrategia que T-14 (cede en
   * silencio) ya no sigue.
   */
  async crear(usuarioId: string, dto: CrearVendedorDto): Promise<Vendedor> {
    const actor = await this.repo.buscarSucursalUsuario(usuarioId);
    if (!actor) {
      throw new UnauthorizedException('Sesion invalida.');
    }

    const sucursalId = actor.id ?? dto.sucursalId;
    if (!sucursalId) {
      throw new BadRequestException(
        'Indica a qué sucursal pertenece el vendedor.',
      );
    }

    const segmento = candidatosDeSegmento(dto.nombre)[0];
    const passwordHash = await this.password.hashear(dto.contrasena);

    try {
      return await this.repo.crear({
        nombre: dto.nombre,
        login: dto.login,
        passwordHash,
        sucursalId,
        folioSegmento: segmento,
      });
    } catch (error) {
      if (esViolacionUnicidad(error)) {
        if (nombreDelIndice(error) === 'uq_vendedor_folio_segmento') {
          throw new ConflictException(
            `Ya hay un vendedor en esta sucursal con esas iniciales (${segmento}). Ajusta el nombre para diferenciarlo.`,
          );
        }
        throw new ConflictException(
          `Ya existe un vendedor con el login "${dto.login}".`,
        );
      }
      if (esViolacionFk(error)) {
        throw new NotFoundException('Alguno de los datos enviados no existe.');
      }
      throw error;
    }
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
