import { Module } from '@nestjs/common';
import { CarteraClientesModule } from '../cartera-clientes/cartera-clientes.module';
import { CobranzasRepository } from './cobranzas.repository';
import { CobranzasService } from './cobranzas.service';
import { FoliosOficinaRepository } from './folios-oficina.repository';
import { VentasController } from './ventas.controller';
import { VentasPortalRepository } from './ventas-portal.repository';
import { VentasPortalService } from './ventas-portal.service';
import { VentasRepository } from './ventas.repository';
import { VentasService } from './ventas.service';

// Ventas y Cobranza. Exporta `VentasService` (T-16) y `CobranzasService` (T-20)
// para que sincronizacion/ despache las operaciones de la tablet (ADR-0009); la
// dependencia va de sincronizacion hacia aqui, nunca al reves. Importa Cartera
// de Clientes porque es la duena de los precios.
//
// T-17: el portal registra ventas por `VentasController`, que entra por el
// mismo `VentasService` que la tablet.
@Module({
  imports: [CarteraClientesModule],
  controllers: [VentasController],
  providers: [
    VentasService,
    VentasRepository,
    CobranzasService,
    CobranzasRepository,
    FoliosOficinaRepository,
    VentasPortalService,
    VentasPortalRepository,
  ],
  exports: [VentasService, CobranzasService],
})
export class VentasCobranzaModule {}
