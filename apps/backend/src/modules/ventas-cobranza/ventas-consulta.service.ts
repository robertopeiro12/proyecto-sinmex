import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { hoyEnTijuana } from '../sincronizacion/operaciones';
import {
  normalizarSucursalPedida,
  resolverAlcance,
} from '../sucursales/alcance-sucursal';
import { accionesDeVenta, type AccionesVenta } from './acciones-venta';
import { exigirAlcanceSobre } from './alcance-venta';
import type { BuscarVentasDto } from './dto/buscar-ventas.dto';
import { saldoDerivadoCentavos } from './reglas-cobranza';
import { esFechaReal } from './venta-portal';
import {
  VentasConsultaRepository,
  type CabeceraVenta,
  type CobroDeVenta,
  type LineaDeVenta,
  type VentaEncontrada,
} from './ventas-consulta.repository';
import { VentasPortalRepository } from './ventas-portal.repository';

/** §3.1: mas filas que esto no caben en una pantalla util; se pide acotar. */
export const TOPE_BUSQUEDA_VENTAS = 200;

export interface ResultadoBusquedaVentas {
  ventas: VentaEncontrada[];
  /** Habia mas de `TOPE_BUSQUEDA_VENTAS`: la pantalla pide acotar el rango. */
  hayMas: boolean;
}

export interface LineaDetalleVenta extends LineaDeVenta {
  subtotalCentavos: number;
}

/** El detalle de §3.2 y lo que devuelven PATCH y la cuenta perdida. */
export interface VentaDetalle extends CabeceraVenta, AccionesVenta {
  saldoCentavos: number;
  lineas: LineaDetalleVenta[];
  cobros: CobroDeVenta[];
}

/** Busqueda y detalle de ventas en el portal (T-17 parte 2, §3.1-§3.2). */
@Injectable()
export class VentasConsultaService {
  constructor(
    private readonly repo: VentasConsultaRepository,
    private readonly portal: VentasPortalRepository,
  ) {}

  async buscar(
    usuarioId: string,
    consulta: BuscarVentasDto,
  ): Promise<ResultadoBusquedaVentas> {
    const hoy = hoyEnTijuana();
    const desde = consulta.desde ?? hoy;
    const hasta = consulta.hasta ?? hoy;
    if (!esFechaReal(desde) || !esFechaReal(hasta))
      throw new BadRequestException('Esa fecha no existe.');
    if (desde > hasta)
      throw new BadRequestException(
        'La fecha "desde" no puede ser posterior a "hasta".',
      );

    const usuario = await this.portal.buscarSucursalUsuario(usuarioId);
    if (!usuario) throw new UnauthorizedException('Sesion invalida.');
    // Mismo patron que los catalogos: el query param es solo preferencia;
    // pedir una sucursal ajena por nombre es 403.
    const alcance = resolverAlcance(
      usuario.codigo,
      normalizarSucursalPedida(consulta.sucursal),
    );

    const filas = await this.repo.buscar(
      {
        desde,
        hasta,
        sucursalCodigo: alcance.tipo === 'todas' ? null : alcance.codigo,
        clienteId: consulta.clienteId?.toLowerCase() ?? null,
        numNota: consulta.numNota || null,
      },
      TOPE_BUSQUEDA_VENTAS + 1,
    );
    return {
      ventas: filas.slice(0, TOPE_BUSQUEDA_VENTAS),
      hayMas: filas.length > TOPE_BUSQUEDA_VENTAS,
    };
  }

  async detalle(usuarioId: string, id: string): Promise<VentaDetalle> {
    const cabecera = await this.repo.cabecera(id);
    if (!cabecera) throw new NotFoundException('No existe esa venta.');
    exigirAlcanceSobre(
      await this.portal.buscarSucursalUsuario(usuarioId),
      cabecera.sucursalCodigo,
    );
    return this.completar(cabecera);
  }

  /**
   * El detalle SIN comprobar alcance: para la edicion, que ya lo comprobo
   * dentro de su transaccion. 404 si la venta ya no existe.
   */
  async leerDetalle(id: string): Promise<VentaDetalle> {
    const cabecera = await this.repo.cabecera(id);
    if (!cabecera) throw new NotFoundException('No existe esa venta.');
    return this.completar(cabecera);
  }

  /** Lineas, cobros, saldo y banderas: lo mismo para el detalle y tras una escritura. */
  private async completar(cabecera: CabeceraVenta): Promise<VentaDetalle> {
    const [lineas, cobros] = await Promise.all([
      this.repo.lineas(cabecera.id),
      this.repo.cobros(cabecera.id),
    ]);
    const abonado = cobros.reduce((t, c) => t + c.montoCentavos, 0);
    const deCobranza = cobros.filter((c) => c.origen === 'cobro').length;
    return {
      ...cabecera,
      saldoCentavos: saldoDerivadoCentavos(cabecera.montoCentavos, abonado),
      lineas: lineas.map((l) => ({
        ...l,
        subtotalCentavos: l.cantidad * l.precioCentavos,
      })),
      cobros,
      ...accionesDeVenta(cabecera.status, deCobranza, cabecera.facturaNumero),
    };
  }
}
