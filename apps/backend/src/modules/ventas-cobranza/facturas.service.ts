import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Transaction } from 'kysely';
import { esViolacionUnicidad } from '../../database/errores-postgres';
import type { DB } from '../../database/schema';
import { resolverAlcance } from '../sucursales/alcance-sucursal';
import { exigirAlcanceSobre } from './alcance-venta';
import type { AsignarFacturaDto, BuscarFacturasDto } from './dto/facturas.dto';
import {
  MOTIVO_CARRERA,
  MOTIVO_NUMERO_INVALIDO,
  motivoAlAsignar,
  motivoAlQuitar,
  motivoDeOtroCliente,
  motivoYaTieneEseNumero,
  normalizarNumeroFactura,
} from './facturas';
import {
  FacturasRepository,
  type FacturaBloqueada,
  type FacturaConVentas,
  type VentaPorFacturar,
} from './facturas.repository';
import { VentasPortalRepository } from './ventas-portal.repository';

/**
 * Asignar factura a notas de ventas (T-19). Cada escritura es UNA transaccion
 * que bloquea primero lo que toca; si una venta no se puede, no se asigna
 * ninguna. El `23505` de `uq_factura_numero` (dos usuarios creando el mismo
 * numero a la vez) se traduce DESPUES del rollback, releyendo con la conexion
 * normal: la transaccion abortada ya no admite consultas (mismo patron que la
 * colision de folio de T-14).
 */
@Injectable()
export class FacturasService {
  constructor(
    private readonly repo: FacturasRepository,
    private readonly portal: VentasPortalRepository,
  ) {}

  async porFacturar(
    usuarioId: string,
    clienteId: string,
    incluirNA: boolean,
  ): Promise<VentaPorFacturar[]> {
    const cliente = await this.portal.clienteDeVenta(clienteId);
    if (!cliente) throw new NotFoundException('No existe ese cliente.');
    exigirAlcanceSobre(
      await this.portal.buscarSucursalUsuario(usuarioId),
      cliente.sucursalCodigo,
    );
    return this.repo.porFacturar(clienteId, incluirNA);
  }

  async asignar(
    usuarioId: string,
    dto: AsignarFacturaDto,
  ): Promise<FacturaConVentas> {
    const numero = normalizarNumeroFactura(dto.numero);
    if (numero === null) throw new BadRequestException(MOTIVO_NUMERO_INVALIDO);
    const ventaIds = [...new Set(dto.ventaIds.map((id) => id.toLowerCase()))];
    const clienteId = dto.clienteId.toLowerCase();

    let facturaId: string;
    try {
      facturaId = await this.portal.enTransaccion(async (trx) => {
        const cliente = await this.portal.clienteDeVenta(clienteId, trx);
        if (!cliente) throw new NotFoundException('No existe ese cliente.');
        exigirAlcanceSobre(
          await this.portal.buscarSucursalUsuario(usuarioId),
          cliente.sucursalCodigo,
        );

        const ventas = await this.repo.bloquearVentas(ventaIds, trx);
        const motivo = motivoAlAsignar(ventaIds, ventas, cliente.id);
        if (motivo) throw new ConflictException(motivo);

        const existente = await this.repo.facturaPorNumero(numero, trx);
        if (existente && existente.clienteId !== cliente.id)
          throw new ConflictException(
            motivoDeOtroCliente(existente.numero, existente.cliente),
          );
        const id =
          existente?.id ??
          (await this.repo.crearFactura(numero, cliente.id, usuarioId, trx));
        await this.repo.asignarVentas(id, ventaIds, usuarioId, trx);
        return id;
      });
    } catch (error) {
      if (esViolacionUnicidad(error))
        throw await this.conflictoDeNumero(numero, clienteId);
      throw error;
    }
    return this.leer(facturaId);
  }

  async renombrar(
    usuarioId: string,
    id: string,
    crudo: string,
  ): Promise<FacturaConVentas> {
    const numero = normalizarNumeroFactura(crudo);
    if (numero === null) throw new BadRequestException(MOTIVO_NUMERO_INVALIDO);
    let clienteId: string | null = null;
    try {
      await this.portal.enTransaccion(async (trx) => {
        const factura = await this.bloquearConAlcance(usuarioId, id, trx);
        clienteId = factura.clienteId;
        const otra = await this.repo.facturaPorNumero(numero, trx);
        // La misma factura con otra capitalizacion NO es "otra".
        if (otra && otra.id !== factura.id)
          throw new ConflictException(
            otra.clienteId === factura.clienteId
              ? motivoYaTieneEseNumero(otra.numero)
              : motivoDeOtroCliente(otra.numero, otra.cliente),
          );
        await this.repo.renombrar(id, numero, usuarioId, trx);
      });
    } catch (error) {
      if (esViolacionUnicidad(error))
        throw await this.conflictoDeNumero(numero, clienteId);
      throw error;
    }
    return this.leer(id);
  }

  async quitar(
    usuarioId: string,
    id: string,
    ventaIdsCrudos: string[],
  ): Promise<{ factura: FacturaConVentas | null }> {
    const ventaIds = [...new Set(ventaIdsCrudos.map((v) => v.toLowerCase()))];
    const borrada = await this.portal.enTransaccion(async (trx) => {
      const factura = await this.bloquearConAlcance(usuarioId, id, trx);
      const ventas = await this.repo.bloquearVentas(ventaIds, trx);
      const motivo = motivoAlQuitar(
        ventaIds,
        ventas,
        factura.id,
        factura.numero,
      );
      if (motivo) throw new ConflictException(motivo);
      await this.repo.quitarVentas(factura.id, ventaIds, trx);
      return this.repo.borrarSiVacia(factura.id, trx);
    });
    return { factura: borrada ? null : await this.leer(id) };
  }

  async buscar(
    usuarioId: string,
    dto: BuscarFacturasDto,
  ): Promise<FacturaConVentas[]> {
    const numero = dto.numero ? dto.numero : null;
    const clienteId = dto.clienteId ?? null;
    if (numero === null && clienteId === null)
      throw new BadRequestException(
        'Busca por número de factura o por cliente.',
      );
    const usuario = await this.portal.buscarSucursalUsuario(usuarioId);
    exigirAlcanceSobre(usuario, usuario?.codigo ?? '');
    const alcance = resolverAlcance(
      usuario?.codigo ?? null,
      dto.sucursal?.trim() || null,
    );
    return this.repo.buscar({
      numero,
      clienteId,
      sucursalCodigo: alcance.tipo === 'una' ? alcance.codigo : null,
    });
  }

  private async bloquearConAlcance(
    usuarioId: string,
    id: string,
    trx: Transaction<DB>,
  ): Promise<FacturaBloqueada> {
    const factura = await this.repo.bloquearFactura(id, trx);
    if (!factura) throw new NotFoundException('No existe esa factura.');
    exigirAlcanceSobre(
      await this.portal.buscarSucursalUsuario(usuarioId),
      factura.sucursalCodigo,
    );
    return factura;
  }

  private async leer(id: string): Promise<FacturaConVentas> {
    const factura = await this.repo.leerFactura(id);
    if (!factura) throw new NotFoundException('No existe esa factura.');
    return factura;
  }

  /** Tras el rollback de un `23505`: ¿quien gano la carrera? */
  private async conflictoDeNumero(
    numero: string,
    clienteId: string | null,
  ): Promise<ConflictException> {
    const ganadora = await this.repo.facturaPorNumero(numero);
    if (ganadora && ganadora.clienteId !== clienteId)
      return new ConflictException(
        motivoDeOtroCliente(ganadora.numero, ganadora.cliente),
      );
    return new ConflictException(MOTIVO_CARRERA);
  }
}
