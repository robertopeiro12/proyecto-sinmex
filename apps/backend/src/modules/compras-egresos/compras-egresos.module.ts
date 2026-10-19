import { Module } from '@nestjs/common';
import { CamposEgresoController } from './campos-egreso.controller';
import { CamposEgresoRepository } from './campos-egreso.repository';
import { CamposEgresoService } from './campos-egreso.service';
import { GastosRepository } from './gastos.repository';
import { GastosService } from './gastos.service';

// T-30/T-31: el catalogo de campos de egreso y los gastos viven aqui (slug del
// vault `compras-egresos`, ADR-0009). `GastosService` se exporta para que
// sincronizacion/ proyecte el `tipo: 'gasto'` y anote su foto; la dependencia
// va de sincronizacion hacia aqui, nunca al reves.
@Module({
  controllers: [CamposEgresoController],
  providers: [
    CamposEgresoService,
    CamposEgresoRepository,
    GastosService,
    GastosRepository,
  ],
  exports: [GastosService],
})
export class ComprasEgresosModule {}
