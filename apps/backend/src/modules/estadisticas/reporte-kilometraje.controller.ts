import { Controller, Get, Query } from '@nestjs/common';
import { RequierePermiso } from '../auth/requiere-permiso.decorator';
import { UsuarioActual } from '../auth/usuario-actual.decorator';
import { ReporteKilometrajeDto } from './dto/reporte-kilometraje.dto';
import type { ReporteKilometraje } from './reglas-kilometraje';
import { ReporteKilometrajeService } from './reporte-kilometraje.service';
import { ReporteVentasDto } from './dto/reporte-ventas.dto';
import type { ReporteVentas } from './reglas-reporte-ventas';
import { ReporteVentasService } from './reporte-ventas.service';

// T-50 y T-49. Kilometraje usa `reportes.ver`; Ventas, `reporte_ventas.ver`.
@Controller('reportes')
export class ReportesController {
  constructor(
    private readonly kilometraje: ReporteKilometrajeService,
    private readonly ventasSrv: ReporteVentasService,
  ) {}

  @Get('kilometraje')
  @RequierePermiso('reportes.ver')
  reporteKilometraje(
    @UsuarioActual() usuarioId: string,
    @Query() q: ReporteKilometrajeDto,
  ): Promise<ReporteKilometraje> {
    return this.kilometraje.kilometraje(usuarioId, q);
  }

  // T-49. Permiso propio del Reporte de Ventas (sembrado en T-05), no `reportes.ver`.
  @Get('ventas')
  @RequierePermiso('reporte_ventas.ver')
  reporteVentas(
    @UsuarioActual() usuarioId: string,
    @Query() q: ReporteVentasDto,
  ): Promise<ReporteVentas> {
    return this.ventasSrv.ventas(usuarioId, q);
  }
}
