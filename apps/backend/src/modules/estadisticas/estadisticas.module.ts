import { Module } from '@nestjs/common';
import { ReportesController } from './reporte-kilometraje.controller';
import { ReporteKilometrajeRepository } from './reporte-kilometraje.repository';
import { ReporteKilometrajeService } from './reporte-kilometraje.service';

// "Estadisticas y Reportes" del vault. T-50 trae el primero: Kilometraje
// (lee `jornada` de T-38; no escribe nada).
@Module({
  controllers: [ReportesController],
  providers: [ReporteKilometrajeService, ReporteKilometrajeRepository],
})
export class EstadisticasModule {}
