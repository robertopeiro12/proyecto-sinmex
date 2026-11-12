import { Module } from '@nestjs/common';
import { CargasController } from './cargas.controller';
import { CargasRepository } from './cargas.repository';
import { CargasService } from './cargas.service';
import { CortesController } from './cortes.controller';
import { CortesRepository } from './cortes.repository';
import { CortesService } from './cortes.service';
import { ProduccionController } from './produccion.controller';
import { ProduccionRepository } from './produccion.repository';
import { ProduccionService } from './produccion.service';

// T-27 pieza 1: la carga y las recargas del vendedor (tabla `carga`). Exporta
// `CargasService` para que sincronizacion/ baje las cargas en el pull y atienda
// la respuesta de la tablet (ADR-0009: la dependencia va de sincronizacion hacia
// aqui, nunca al reves).
//
// T-25: la produccion por dia (tabla `produccion`), solo para el portal.
//
// Corte de mercancia (tablas `retorno` y `corte_mercancia`), solo para el
// portal: absorbe a Retorno (`/retornos` se quito). Lee cargas y ventas para
// calcular lo que deberia regresar; no las toca.
@Module({
  controllers: [CargasController, CortesController, ProduccionController],
  providers: [
    CargasService,
    CargasRepository,
    CortesService,
    CortesRepository,
    ProduccionService,
    ProduccionRepository,
  ],
  exports: [CargasService],
})
export class ProduccionModule {}
