import { Module } from '@nestjs/common';
import { TesoreriaController } from './tesoreria.controller';
import { TesoreriaRepository } from './tesoreria.repository';
import { TesoreriaService } from './tesoreria.service';

// T-28: cuentas y saldos fijados. T-29 agregara los movimientos aqui mismo.
@Module({
  controllers: [TesoreriaController],
  providers: [TesoreriaService, TesoreriaRepository],
})
export class TesoreriaModule {}
