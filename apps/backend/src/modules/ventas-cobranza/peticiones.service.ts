import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Transaction } from 'kysely';
import {
  esConflictoDeConcurrencia,
  esViolacionUnicidad,
  restriccionDelError,
} from '../../database/errores-postgres';
import type { DB } from '../../database/schema';
import {
  normalizarSucursalPedida,
  resolverAlcance,
} from '../sucursales/alcance-sucursal';
import { exigirAlcanceSobre } from './alcance-venta';
import { CobrosBorradoRepository } from './cobros-borrado.repository';
import {
  CobroNoBorrable,
  CobrosBorradoService,
  MOTIVO_COBRO_BORRADO,
  MOTIVO_COBRO_NO_EXISTE,
  type VistaBorrado,
} from './cobros-borrado.service';
import { MOTIVO_INTERBLOQUEO_COBRO } from './cobranzas-portal.service';
import type {
  BandejaDto,
  DenegarPeticionDto,
  SolicitarEliminarCobroDto,
} from './dto/peticiones.dto';
import {
  PeticionesRepository,
  type PeticionEnBandeja,
  type PeticionParaResolver,
} from './peticiones.repository';
import { VentasPortalRepository } from './ventas-portal.repository';

export const MOTIVO_PETICION_NO_EXISTE = 'No existe esa petición.';
export const MOTIVO_PETICION_RESUELTA = 'Esta petición ya fue resuelta.';
export const MOTIVO_PETICION_PENDIENTE =
  'Este cobro ya tiene una petición de borrado pendiente.';
export const MOTIVO_SIN_MOTIVO = 'Escribe el motivo de la petición.';
export const MOTIVO_MOTIVO_LARGO =
  'El motivo no puede pasar de 500 caracteres.';
export const MOTIVO_COMENTARIO_LARGO =
  'El comentario no puede pasar de 500 caracteres.';

const LARGO_MAX = 500;

/** El motivo recortado; vacio o de mas de 500 es 400 (`ck_peticion_motivo` lo repite en la base). */
export function normalizarMotivo(crudo: string | undefined): string {
  const motivo = (crudo ?? '').trim();
  if (motivo === '') throw new BadRequestException(MOTIVO_SIN_MOTIVO);
  if (motivo.length > LARGO_MAX)
    throw new BadRequestException(MOTIVO_MOTIVO_LARGO);
  return motivo;
}

/** El comentario de una denegacion: opcional, recortado, `null` si viene vacio. */
export function normalizarComentario(crudo: string | undefined): string | null {
  const comentario = (crudo ?? '').trim();
  if (comentario === '') return null;
  if (comentario.length > LARGO_MAX)
    throw new BadRequestException(MOTIVO_COMENTARIO_LARGO);
  return comentario;
}

type UsuarioConSucursal = Parameters<typeof exigirAlcanceSobre>[0];

/**
 * Peticiones (T-34): pedir el borrado de un pago y autorizarlo o denegarlo.
 *
 * - **Alcance primero**: se compara contra la sucursal LEIDA (del cliente del
 *   pago, o la que guardo la peticion), y ANTES de decir si el pago esta
 *   borrado o la peticion resuelta, para no revelar nada de otra sucursal.
 * - **Una transaccion por accion**; al autorizar, la peticion se bloquea
 *   PRIMERO y despues `CobrosBorradoService.borrar` toma los candados del cobro.
 * - Quien pide puede ser quien autoriza (decision de Roberto, 2026-10-13).
 */
@Injectable()
export class PeticionesService {
  constructor(
    private readonly repo: PeticionesRepository,
    private readonly borrado: CobrosBorradoService,
    private readonly cobros: CobrosBorradoRepository,
    private readonly portal: VentasPortalRepository,
  ) {}

  async bandeja(
    usuarioId: string,
    dto: BandejaDto,
  ): Promise<PeticionEnBandeja[]> {
    const usuario = await this.portal.buscarSucursalUsuario(usuarioId);
    if (!usuario) throw new UnauthorizedException('Sesion invalida.');
    // El query param es solo preferencia; pedir una sucursal ajena es 403.
    const alcance = resolverAlcance(
      usuario.codigo,
      normalizarSucursalPedida(dto.sucursal),
    );
    return this.repo.buscar({
      status: dto.status,
      sucursalCodigo: alcance.tipo === 'una' ? alcance.codigo : null,
    });
  }

  /** `GET /cobros/:id/vista-borrado`: para quien pide. */
  async vistaDeCobro(
    usuarioId: string,
    cobroId: string,
  ): Promise<VistaBorrado> {
    const usuario = await this.portal.buscarSucursalUsuario(usuarioId);
    return this.enTransaccion(async (trx) => {
      await this.cobroConAlcance(usuario, cobroId, trx);
      return this.borrado.planear(cobroId, trx);
    });
  }

  /** `GET /peticiones/:id/vista-previa`: para quien autoriza, recalculada al momento. */
  async vistaDePeticion(
    usuarioId: string,
    peticionId: string,
  ): Promise<VistaBorrado> {
    const usuario = await this.portal.buscarSucursalUsuario(usuarioId);
    return this.enTransaccion(async (trx) => {
      const peticion = await this.repo.cabecera(peticionId, trx);
      this.exigirPeticion(usuario, peticion);
      return this.borrado.planear(peticion.cobroId, trx);
    });
  }

  async solicitarEliminarCobro(
    usuarioId: string,
    dto: SolicitarEliminarCobroDto,
  ): Promise<PeticionEnBandeja> {
    const motivo = normalizarMotivo(dto.motivo);
    const cobroId = dto.cobroId.toLowerCase();
    // Fuera de la transaccion: dentro seria una segunda conexion abierta a la vez.
    const usuario = await this.portal.buscarSucursalUsuario(usuarioId);

    const id = await this.enTransaccion(async (trx) => {
      // `for share`: si alguien esta autorizando el borrado de este pago, se
      // espera a que confirme y aqui ya se ve borrado (409), sin dejar una
      // peticion pendiente sobre un pago que ya no existe.
      const cabecera = await this.cobroConAlcance(usuario, cobroId, trx, true);
      if (cabecera.borrado) throw new ConflictException(MOTIVO_COBRO_BORRADO);
      try {
        return await this.repo.insertar(
          { cobroId, sucursalId: cabecera.sucursalId, motivo, usuarioId },
          trx,
        );
      } catch (error) {
        if (
          esViolacionUnicidad(error) &&
          restriccionDelError(error) === 'uq_peticion_cobro_pendiente'
        )
          throw new ConflictException(MOTIVO_PETICION_PENDIENTE);
        throw error;
      }
    });
    return this.unaPeticion(id);
  }

  async autorizar(
    usuarioId: string,
    peticionId: string,
  ): Promise<PeticionEnBandeja> {
    const usuario = await this.portal.buscarSucursalUsuario(usuarioId);
    await this.enTransaccion(async (trx) => {
      const peticion = await this.pendienteBloqueada(usuario, peticionId, trx);
      // Si no se puede (saldo a favor ya aplicado), lanza y la transaccion
      // entera se revierte: la peticion sigue pendiente.
      await this.borrado.borrar(peticion.cobroId, usuarioId, trx);
      await this.repo.resolver(
        peticion.id,
        { status: 'autorizada', usuarioId, comentario: null },
        trx,
      );
    });
    return this.unaPeticion(peticionId);
  }

  async denegar(
    usuarioId: string,
    peticionId: string,
    dto: DenegarPeticionDto,
  ): Promise<PeticionEnBandeja> {
    const comentario = normalizarComentario(dto.comentario);
    const usuario = await this.portal.buscarSucursalUsuario(usuarioId);
    await this.enTransaccion(async (trx) => {
      const peticion = await this.pendienteBloqueada(usuario, peticionId, trx);
      await this.repo.resolver(
        peticion.id,
        { status: 'denegada', usuarioId, comentario },
        trx,
      );
    });
    return this.unaPeticion(peticionId);
  }

  /* ---------------------------------------------------------------- */

  private async cobroConAlcance(
    usuario: UsuarioConSucursal,
    cobroId: string,
    trx: Transaction<DB>,
    compartido = false,
  ) {
    const cabecera = await this.cobros.cabecera(cobroId, trx, compartido);
    if (!cabecera) throw new NotFoundException(MOTIVO_COBRO_NO_EXISTE);
    exigirAlcanceSobre(usuario, cabecera.sucursalCodigo);
    return cabecera;
  }

  private exigirPeticion(
    usuario: UsuarioConSucursal,
    peticion: PeticionParaResolver | undefined,
  ): asserts peticion is PeticionParaResolver {
    if (!peticion) throw new NotFoundException(MOTIVO_PETICION_NO_EXISTE);
    exigirAlcanceSobre(usuario, peticion.sucursalCodigo);
  }

  private async pendienteBloqueada(
    usuario: UsuarioConSucursal,
    peticionId: string,
    trx: Transaction<DB>,
  ): Promise<PeticionParaResolver> {
    const peticion = await this.repo.bloquear(peticionId, trx);
    this.exigirPeticion(usuario, peticion);
    if (peticion.status !== 'pendiente')
      throw new ConflictException(MOTIVO_PETICION_RESUELTA);
    return peticion;
  }

  private async unaPeticion(id: string): Promise<PeticionEnBandeja> {
    const [peticion] = await this.repo.buscar({ id, sucursalCodigo: null });
    if (!peticion) throw new NotFoundException(MOTIVO_PETICION_NO_EXISTE);
    return peticion;
  }

  /**
   * UNA transaccion. Kysely ya hizo rollback cuando llega el `catch`: aqui solo
   * se traduce a HTTP. Un interbloqueo con un cobro de la tablet (o de otro
   * usuario) sale como 409, nunca como 500 (mismo trato que T-21).
   */
  private async enTransaccion<T>(
    tarea: (trx: Transaction<DB>) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.portal.enTransaccion(tarea);
    } catch (error) {
      if (error instanceof CobroNoBorrable)
        throw error.razon === 'no-existe'
          ? new NotFoundException(error.message)
          : new ConflictException(error.message);
      if (esConflictoDeConcurrencia(error))
        throw new ConflictException(MOTIVO_INTERBLOQUEO_COBRO);
      throw error;
    }
  }
}
