import { Module } from '@nestjs/common';
import { ReporteClientesNuevosRepository } from './reporte-clientes-nuevos.repository';
import { ReporteClientesNuevosService } from './reporte-clientes-nuevos.service';
import { ReportesController } from './reporte-kilometraje.controller';
import { ReporteKilometrajeRepository } from './reporte-kilometraje.repository';
import { ReporteKilometrajeService } from './reporte-kilometraje.service';
import { ReporteVentasRepository } from './reporte-ventas.repository';
import { ReporteVentasService } from './reporte-ventas.service';

// "Estadisticas y Reportes" del vault. T-50 trae Kilometraje (lee `jornada`);
// T-49, Ventas (lee `venta_nota`);
// T-51, Clientes nuevos (lee `cliente`). Ninguno escribe nada.
@Module({
  controllers: [ReportesController],
  providers: [
    ReporteKilometrajeService,
    ReporteKilometrajeRepository,
    ReporteVentasService,
    ReporteVentasRepository,
    ReporteClientesNuevosService,
    ReporteClientesNuevosRepository,
  ],
})
export class EstadisticasModule {}
