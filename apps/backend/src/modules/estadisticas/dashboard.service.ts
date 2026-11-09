import { BadRequestException, Injectable } from '@nestjs/common';
import { hoyEnTijuana } from '../sincronizacion/operaciones';
import { DetalleRepository } from './detalle.repository';
import { FlujoDiarioRepository } from './flujo-diario.repository';
import { FlujoDiarioService } from './flujo-diario.service';
import type { DetalleVendedorDia } from './reglas-detalle';
import {
  armarDashboard,
  fechaValidaDashboard,
  type Dashboard,
} from './reglas-flujo-diario';

/**
 * Dashboard: el flujo de HOY. El dia lo pone el servidor (hoy de Tijuana);
 * `ahora` existe solo para que las pruebas simulen la hora.
 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly repo: FlujoDiarioRepository,
    private readonly flujo: FlujoDiarioService,
    private readonly detalleRepo: DetalleRepository,
  ) {}

  /**
   * Casilla "Entregada": marca si el vendedor regreso la nota de papel. Solo
   * notas vivas a credito de ese vendedor, de hoy (Tijuana) o antes; una que no
   * cumple tumba todo el lote (400) y no se guarda nada.
   */
  async marcarNotasEntregadas(
    usuarioId: string,
    q: { vendedor: string; notas: { folio: string; entregada: boolean }[] },
    ahora?: Date,
  ): Promise<void> {
    const id = this.flujo.idVendedor(q.vendedor);
    const alcance = await this.flujo.alcanceDe(usuarioId, undefined);
    const vendedor = await this.flujo.vendedorEnAlcance(
      id,
      alcance.tipo === 'una' ? alcance.codigo : null,
    );
    // Si un folio viene dos veces, gana la ultima marca.
    const porFolio = new Map(q.notas.map((n) => [n.folio.trim(), n.entregada]));
    const { invalido } = await this.detalleRepo.marcarPapel(
      vendedor.id,
      hoyEnTijuana(ahora),
      usuarioId,
      [...porFolio].map(([folio, entregada]) => ({ folio, entregada })),
    );
    if (invalido !== null)
      throw new BadRequestException(`La nota ${invalido} no se puede revisar.`);
  }

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
      // Hoy no se lista a quien esta inactivo o dado de baja solo por su ruta.
      soloVigentesEnRuta: true,
    });
    return armarDashboard(hoy, filas);
  }

  /**
   * El mismo detalle del Flujo diario. El portal manda la fecha del Dashboard que
   * pinto (hoy o ayer, por la medianoche); sin ella, hoy.
   */
  detalle(
    usuarioId: string,
    q: { vendedor: string; sucursal?: string; fecha?: string },
    ahora?: Date,
  ): Promise<DetalleVendedorDia> {
    const hoy = hoyEnTijuana(ahora);
    const fecha = q.fecha?.trim() || hoy;
    if (!fechaValidaDashboard(fecha, hoy))
      throw new BadRequestException('La fecha no es válida para el Dashboard.');
    return this.flujo.detalleVendedor(usuarioId, {
      fecha,
      vendedor: q.vendedor,
      sucursal: q.sucursal,
    });
  }
}
