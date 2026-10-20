import { Module } from '@nestjs/common';
import { CarteraClientesModule } from '../cartera-clientes/cartera-clientes.module';
import { CamposEgresoController } from './campos-egreso.controller';
import { CamposEgresoRepository } from './campos-egreso.repository';
import { CamposEgresoService } from './campos-egreso.service';
import { GastosController } from './gastos.controller';
import { GastosRepository } from './gastos.repository';
import { GastosService } from './gastos.service';

// T-30: el catalogo de campos de egreso. T-30/T-31: la tabla `gasto`; exporta
// `GastosService` para que sincronizacion/ proyecte el `tipo: 'gasto'` y suba la
// foto del ticket (ADR-0009). Importa Cartera de Clientes por `FotosService`: la
// foto del ticket vive en el mismo disco que la del cliente.
@Module({
  imports: [CarteraClientesModule],
  controllers: [CamposEgresoController, GastosController],
  providers: [
    CamposEgresoService,
    CamposEgresoRepository,
    GastosService,
    GastosRepository,
  ],
  exports: [GastosService],
})
export class ComprasEgresosModule {}
