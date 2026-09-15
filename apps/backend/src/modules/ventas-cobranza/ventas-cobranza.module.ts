import { Module } from '@nestjs/common';
import { CarteraClientesModule } from '../cartera-clientes/cartera-clientes.module';
import { VentasRepository } from './ventas.repository';
import { VentasService } from './ventas.service';

// Ventas y Cobranza (T-16 llena el primer servicio). Exporta `VentasService`
// para que sincronizacion/ despache las ventas de la tablet (ADR-0009); la
// dependencia va de sincronizacion hacia aqui, nunca al reves. Importa Cartera
// de Clientes porque es la duena de los precios.
@Module({
  imports: [CarteraClientesModule],
  providers: [VentasService, VentasRepository],
  exports: [VentasService],
})
export class VentasCobranzaModule {}
