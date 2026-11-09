import { Injectable } from '@nestjs/common';
import { hoyEnTijuana } from '../sincronizacion/operaciones';
import { FlujoDiarioRepository } from './flujo-diario.repository';
import { FlujoDiarioService } from './flujo-diario.service';
import type { DetalleVendedorDia } from './reglas-detalle';
import { armarDashboard, type Dashboard } from './reglas-flujo-diario';

/**
 * Dashboard: el flujo de HOY. El dia lo pone el servidor (hoy de Tijuana);
 * `ahora` existe solo para que las pruebas simulen la hora.
 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly repo: FlujoDiarioRepository,
    private readonly flujo: FlujoDiarioService,
  ) {}

  async dashboard(
    usuarioId: string,
    q: { sucursal?: string },
    ahora?: Date,
  ): Promise<Dashboard> {
    const hoy = hoyEnTijuana(ahora);
    const alcance = await this.flujo.alcanceDe(usuarioId, q.sucursal);
    const filas = await this.repo.filas({
      desde: hoy,
      hasta: hoy,
      codigoSucursal: alcance.tipo === 'una' ? alcance.codigo : null,
      vendedorId: null,
    });
    return armarDashboard(hoy, filas);
  }

  /** El mismo detalle del Flujo diario, con la fecha de hoy. */
  detalle(
    usuarioId: string,
    q: { vendedor: string; sucursal?: string },
    ahora?: Date,
  ): Promise<DetalleVendedorDia> {
    return this.flujo.detalleVendedor(usuarioId, {
      fecha: hoyEnTijuana(ahora),
      vendedor: q.vendedor,
      sucursal: q.sucursal,
    });
  }
}
