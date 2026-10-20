import { Module } from '@nestjs/common';
import { CargasController } from './cargas.controller';
import { CargasRepository } from './cargas.repository';
import { CargasService } from './cargas.service';

// T-27 pieza 1: la carga y las recargas del vendedor (tabla `carga`). Exporta
// `CargasService` para que sincronizacion/ baje las cargas en el pull y atienda
// la respuesta de la tablet (ADR-0009: la dependencia va de sincronizacion hacia
// aqui, nunca al reves).
@Module({
  controllers: [CargasController],
  providers: [CargasService, CargasRepository],
  exports: [CargasService],
})
export class ProduccionModule {}
