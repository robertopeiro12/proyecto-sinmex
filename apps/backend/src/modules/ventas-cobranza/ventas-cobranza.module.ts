import { Module } from '@nestjs/common';
import { CarteraClientesModule } from '../cartera-clientes/cartera-clientes.module';
import { CobranzasRepository } from './cobranzas.repository';
import { CobranzasService } from './cobranzas.service';
import { VentasRepository } from './ventas.repository';
import { VentasService } from './ventas.service';

// Ventas y Cobranza. Exporta `VentasService` (T-16) y `CobranzasService` (T-20)
// para que sincronizacion/ despache las operaciones de la tablet (ADR-0009); la
// dependencia va de sincronizacion hacia aqui, nunca al reves. Importa Cartera
// de Clientes porque es la duena de los precios.
@Module({
  imports: [CarteraClientesModule],
  providers: [
    VentasService,
    VentasRepository,
    CobranzasService,
    CobranzasRepository,
  ],
  exports: [VentasService, CobranzasService],
})
export class VentasCobranzaModule {}
