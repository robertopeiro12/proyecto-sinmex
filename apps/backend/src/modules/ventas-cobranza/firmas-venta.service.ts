import { Injectable, NotFoundException } from '@nestjs/common';
import { FotosService } from '../cartera-clientes/fotos.service';
import { exigirAlcanceSobre } from './alcance-venta';
import {
  FirmasVentaRepository,
  type EstadoFirmaVenta,
} from './firmas-venta.repository';
import { VentasConsultaRepository } from './ventas-consulta.repository';
import { VentasPortalRepository } from './ventas-portal.repository';

const SIN_FIRMA = 'Esa venta no tiene firma.';

/**
 * La firma del cliente en la nota (T-73). Ventas y Cobranza es la duena de
 * `venta_nota` y por tanto de sus columnas de firma (ADR-0009): el canal de
 * fotos de `sincronizacion/` resuelve la clave y despacha aqui, como hace con
 * `GastosService` y `VisitasService`.
 */
@Injectable()
export class FirmasVentaService {
  constructor(
    private readonly repo: FirmasVentaRepository,
    private readonly consulta: VentasConsultaRepository,
    private readonly portal: VentasPortalRepository,
    // La imagen vive en el disco de fotos de Cartera, como el ticket del gasto.
    private readonly fotos: FotosService,
  ) {}

  /** Para el canal de fotos: 404 si `inexistente`, 409 si `no-espera`. */
  estadoFirma(ventaId: string): Promise<EstadoFirmaVenta> {
    return this.repo.estadoFirma(ventaId);
  }

  /** Para el canal de fotos, despues de escribir el archivo. */
  anotarFirma(
    ventaId: string,
    archivo: string,
    subidaEn: Date,
  ): Promise<boolean> {
    return this.repo.anotarFirma(ventaId, archivo, subidaEn);
  }

  /**
   * `GET /ventas/:id/firma`: el mismo alcance que `GET /ventas/:id` (venta viva,
   * 404; otra sucursal, 403 por `exigirAlcanceSobre`), y 404 si la imagen no ha
   * llegado o la venta no la espera.
   */
  async rutaFirma(usuarioId: string, ventaId: string): Promise<string> {
    const cabecera = await this.consulta.cabecera(ventaId);
    if (!cabecera) throw new NotFoundException('No existe esa venta.');
    exigirAlcanceSobre(
      await this.portal.buscarSucursalUsuario(usuarioId),
      cabecera.sucursalCodigo,
    );
    const archivo = await this.repo.archivoFirma(ventaId);
    if (archivo === null) throw new NotFoundException(SIN_FIRMA);
    return this.fotos.rutaDeArchivo(archivo, SIN_FIRMA);
  }
}
