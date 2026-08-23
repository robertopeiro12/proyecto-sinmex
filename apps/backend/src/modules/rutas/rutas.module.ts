import { Module } from '@nestjs/common';
import { VehiculosController } from './vehiculos.controller';
import { VehiculosRepository } from './vehiculos.repository';
import { VehiculosService } from './vehiculos.service';

// Vehiculos vive aqui y no en un `modules/vehiculos/` nuevo: el CLAUDE.md fija
// que los modulos usan los slugs del vault, y `Vehículo.md` declara
// `modulo: rutas` (D1).
@Module({
  controllers: [VehiculosController],
  providers: [VehiculosService, VehiculosRepository],
})
export class RutasModule {}
