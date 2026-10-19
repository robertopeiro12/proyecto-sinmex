import { Module } from '@nestjs/common';
import { CobranzaTesoreriaRepository } from './cobranza-tesoreria.repository';
import { GastosTesoreriaRepository } from './gastos-tesoreria.repository';
import { DestinosController } from './destinos.controller';
import { DestinosRepository } from './destinos.repository';
import { DestinosService } from './destinos.service';
import { MovimientosController } from './movimientos.controller';
import { MovimientosRepository } from './movimientos.repository';
import { MovimientosService } from './movimientos.service';
import { TesoreriaController } from './tesoreria.controller';
import { TesoreriaRepository } from './tesoreria.repository';
import { TesoreriaService } from './tesoreria.service';

// T-28: cuentas y saldos fijados. T-29: movimientos manuales (depositos, retiros, traspasos). T-30/T-31: gastos de la ruta (lectura).
@Module({
  controllers: [TesoreriaController, MovimientosController, DestinosController],
  providers: [
    TesoreriaService,
    TesoreriaRepository,
    MovimientosService,
    MovimientosRepository,
    DestinosService,
    DestinosRepository,
    CobranzaTesoreriaRepository,
    GastosTesoreriaRepository,
  ],
})
export class TesoreriaModule {}
