import { Module } from '@nestjs/common';
import { CuentasPorCobrarController } from './cuentas-por-cobrar.controller';
import { CuentasPorCobrarRepository } from './cuentas-por-cobrar.repository';
import { CuentasPorCobrarService } from './cuentas-por-cobrar.service';

// "Cuentas por Cobrar y Pagar" del vault. T-22 trae la cara de Cobrar (solo
// lectura sobre venta_nota y cobranza_abono); Pagar es T-23.
@Module({
  controllers: [CuentasPorCobrarController],
  providers: [CuentasPorCobrarService, CuentasPorCobrarRepository],
})
export class CuentasCobrarPagarModule {}
