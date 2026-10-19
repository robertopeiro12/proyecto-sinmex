import { Module } from '@nestjs/common';
import { CamposEgresoController } from './campos-egreso.controller';
import { CamposEgresoRepository } from './campos-egreso.repository';
import { CamposEgresoService } from './campos-egreso.service';

// T-30/T-31: el catalogo de campos de egreso y los gastos viven aqui (slug del
// vault `compras-egresos`, ADR-0009).
@Module({
  controllers: [CamposEgresoController],
  providers: [CamposEgresoService, CamposEgresoRepository],
})
export class ComprasEgresosModule {}
