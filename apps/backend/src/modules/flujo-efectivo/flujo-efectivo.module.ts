import { Module } from '@nestjs/common';
import { TesoreriaModule } from '../tesoreria/tesoreria.module';
import { FlujoEfectivoController } from './flujo-efectivo.controller';
import { FlujoEfectivoRepository } from './flujo-efectivo.repository';
import { FlujoEfectivoService } from './flujo-efectivo.service';

// T-32: Flujo de Efectivo (solo lectura); el Total Tesoreria sale de T-28/T-29.
@Module({
  imports: [TesoreriaModule],
  controllers: [FlujoEfectivoController],
  providers: [FlujoEfectivoService, FlujoEfectivoRepository],
})
export class FlujoEfectivoModule {}
