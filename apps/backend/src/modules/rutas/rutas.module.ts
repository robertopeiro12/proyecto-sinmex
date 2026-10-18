import { Module } from '@nestjs/common';
import { JornadasRepository } from './jornadas.repository';
import { JornadasService } from './jornadas.service';
import { MotivosVisitaController } from './motivos-visita.controller';
import { MotivosVisitaRepository } from './motivos-visita.repository';
import { MotivosVisitaService } from './motivos-visita.service';
import { RutasDiariasController } from './rutas-diarias.controller';
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
//
// T-39: el catalogo de motivos de visita vive aqui porque la visita es de Rutas (ADR-0009).
@Module({
  controllers: [
    VehiculosController,
    RutasDiariasController,
    MotivosVisitaController,
  ],
  providers: [
    VehiculosService,
    VehiculosRepository,
    JornadasService,
    JornadasRepository,
    RutasDiariasService,
    RutasDiariasRepository,
    MotivosVisitaService,
    MotivosVisitaRepository,
  ],
  exports: [JornadasService, RutasDiariasService],
})
export class RutasModule {}
