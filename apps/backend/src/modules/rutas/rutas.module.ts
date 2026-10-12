import { Module } from '@nestjs/common';
import { JornadasRepository } from './jornadas.repository';
import { JornadasService } from './jornadas.service';
import { RutasDiariasRepository } from './rutas-diarias.repository';
import { RutasDiariasService } from './rutas-diarias.service';
import { VehiculosController } from './vehiculos.controller';
import { VehiculosRepository } from './vehiculos.repository';
import { VehiculosService } from './vehiculos.service';

// Vehiculos vive aqui y no en un `modules/vehiculos/` nuevo: el CLAUDE.md fija
// que los modulos usan los slugs del vault, y `Vehículo.md` declara
// `modulo: rutas` (D1).
//
// T-38: exporta `JornadasService` para que sincronizacion/ proyecte la jornada
// que sube la tablet (ADR-0009); la dependencia va de sincronizacion hacia
// aqui, nunca al reves. T-37 hace lo mismo con `RutasDiariasService` y el
// `ruta-alta`.
@Module({
  controllers: [VehiculosController],
  providers: [
    VehiculosService,
    VehiculosRepository,
    JornadasService,
    JornadasRepository,
    RutasDiariasService,
    RutasDiariasRepository,
  ],
  exports: [JornadasService, RutasDiariasService],
})
export class RutasModule {}
