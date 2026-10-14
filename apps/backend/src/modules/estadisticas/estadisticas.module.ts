import { Module } from '@nestjs/common';
import { ReportesController } from './reporte-kilometraje.controller';
import { ReporteKilometrajeRepository } from './reporte-kilometraje.repository';
import { ReporteKilometrajeService } from './reporte-kilometraje.service';
import { ReporteVentasRepository } from './reporte-ventas.repository';
import { ReporteVentasService } from './reporte-ventas.service';

// "Estadisticas y Reportes" del vault. T-50 trae Kilometraje (lee `jornada`);
// T-49, Ventas (lee `venta_nota`). Ninguno escribe nada.
@Module({
  controllers: [ReportesController],
  providers: [
    ReporteKilometrajeService,
    ReporteKilometrajeRepository,
    ReporteVentasService,
    ReporteVentasRepository,
  ],
})
export class EstadisticasModule {}
