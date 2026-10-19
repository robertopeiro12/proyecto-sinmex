import { Module } from '@nestjs/common';
import { MovimientosController } from './movimientos.controller';
import { MovimientosRepository } from './movimientos.repository';
import { MovimientosService } from './movimientos.service';
import { TesoreriaController } from './tesoreria.controller';
import { TesoreriaRepository } from './tesoreria.repository';
import { TesoreriaService } from './tesoreria.service';

// T-28: cuentas y saldos fijados. T-29 agregara los movimientos aqui mismo.
@Module({
  controllers: [TesoreriaController, MovimientosController],
  providers: [
    TesoreriaService,
    TesoreriaRepository,
    MovimientosService,
    MovimientosRepository,
  ],
})
export class TesoreriaModule {}
