import { Controller, Get, Query } from '@nestjs/common';
import { RequierePermiso } from '../auth/requiere-permiso.decorator';
import { UsuarioActual } from '../auth/usuario-actual.decorator';
import { ReporteKilometrajeDto } from './dto/reporte-kilometraje.dto';
import type { ReporteKilometraje } from './reglas-kilometraje';
import { ReporteKilometrajeService } from './reporte-kilometraje.service';

// T-50. `reportes.ver` ("Acceso a reportes", sembrado en T-05) es el permiso
// de toda la seccion Informacion -> Reportes.
@Controller('reportes')
export class ReportesController {
  constructor(private readonly kilometraje: ReporteKilometrajeService) {}

  @Get('kilometraje')
  @RequierePermiso('reportes.ver')
  reporteKilometraje(
    @UsuarioActual() usuarioId: string,
    @Query() q: ReporteKilometrajeDto,
  ): Promise<ReporteKilometraje> {
    return this.kilometraje.kilometraje(usuarioId, q);
  }
}
