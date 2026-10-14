import { Controller, Get, Query } from '@nestjs/common';
import { RequierePermiso } from '../auth/requiere-permiso.decorator';
import { UsuarioActual } from '../auth/usuario-actual.decorator';
import { ReporteKilometrajeDto } from './dto/reporte-kilometraje.dto';
import type { ReporteKilometraje } from './reglas-kilometraje';
import { ReporteKilometrajeService } from './reporte-kilometraje.service';
import { ReporteVentasDto } from './dto/reporte-ventas.dto';
import type { ReporteVentas } from './reglas-reporte-ventas';
import { ReporteVentasService } from './reporte-ventas.service';
import { ReporteClientesNuevosDto } from './dto/reporte-clientes-nuevos.dto';
import type { ReporteClientesNuevos } from './reglas-clientes-nuevos';
import { ReporteClientesNuevosService } from './reporte-clientes-nuevos.service';

// T-50, T-49 y T-51. Kilometraje usa `reportes.ver`; Ventas, `reporte_ventas.ver`.
@Controller('reportes')
export class ReportesController {
  constructor(
    private readonly kilometraje: ReporteKilometrajeService,
    private readonly ventasSrv: ReporteVentasService,
    private readonly clientesNuevosSrv: ReporteClientesNuevosService,
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

  // T-51. Seccion Informacion -> Reportes: `reportes.ver`, como Kilometraje.
  @Get('clientes-nuevos')
  @RequierePermiso('reportes.ver')
  reporteClientesNuevos(
    @UsuarioActual() usuarioId: string,
    @Query() q: ReporteClientesNuevosDto,
  ): Promise<ReporteClientesNuevos> {
    return this.clientesNuevosSrv.clientesNuevos(usuarioId, q);
  }
}
