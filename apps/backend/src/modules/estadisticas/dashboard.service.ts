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
   * Revision de papel de la tarde (casilla "Entregada"): las ventas a credito
   * del vendedor ese dia (`notas`, por folio) y sus notas asignadas ese dia
   * (`asignadas`). `fecha` solo puede ser hoy o ayer de Tijuana (se corrige al
   * dia siguiente). Sin `fecha` es hoy y las `notas` aceptan cualquier venta a
   * credito suya hasta hoy (la forma de antes de la parte 2, para el portal
   * viejo). Una nota que no cumple tumba todo el lote (400) y no se guarda nada.
   */
  async marcarNotasEntregadas(
    usuarioId: string,
    q: {
      vendedor: string;
      fecha?: string;
      notas: { folio: string; entregada: boolean }[];
      asignadas?: { ventaNotaId: string; entregada: boolean }[];
    },
    ahora?: Date,
  ): Promise<void> {
    const hoy = hoyEnTijuana(ahora);
    // El DTO ya exige `AAAA-MM-DD` si viene (vacia no es "hoy").
    const pedida = q.fecha ?? null;
    if (pedida !== null && !fechaValidaDashboard(pedida, hoy))
      throw new BadRequestException('Ese día ya no se puede revisar.');
    const fecha = pedida ?? hoy;
    // Si una nota viene dos veces, gana la ultima marca.
    const porFolio = new Map(q.notas.map((n) => [n.folio.trim(), n.entregada]));
    const porVenta = new Map(
      (q.asignadas ?? []).map((a) => [
        a.ventaNotaId.toLowerCase(),
        a.entregada,
      ]),
    );
    if (porFolio.size + porVenta.size === 0)
      throw new BadRequestException('Marca al menos una nota.');

    const id = this.flujo.idVendedor(q.vendedor);
    const alcance = await this.flujo.alcanceDe(usuarioId, undefined);
    const vendedor = await this.flujo.vendedorEnAlcance(
      id,
      alcance.tipo === 'una' ? alcance.codigo : null,
    );
    const { invalido } = await this.detalleRepo.marcarPapel(
      vendedor.id,
      usuarioId,
      { fecha, hasta: pedida === null },
      fecha,
      [...porFolio].map(([folio, entregada]) => ({ folio, entregada })),
      [...porVenta].map(([ventaNotaId, entregada]) => ({
        ventaNotaId,
        entregada,
      })),
    );
    if (invalido === 'asignada')
      throw new BadRequestException(
        'Una de las notas asignadas no se puede revisar.',
      );
    if (invalido !== null)
      throw new BadRequestException(
        `La nota ${invalido.folio} no se puede revisar.`,
      );
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
