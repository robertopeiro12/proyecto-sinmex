import { Module } from '@nestjs/common';
import { CarteraClientesModule } from '../cartera-clientes/cartera-clientes.module';
import { CobranzasRepository } from './cobranzas.repository';
import { CobranzasPortalRepository } from './cobranzas-portal.repository';
import { CobranzasPortalService } from './cobranzas-portal.service';
import { CobranzasController } from './cobranzas.controller';
import { CobranzasService } from './cobranzas.service';
import { FacturasController } from './facturas.controller';
import { FacturasRepository } from './facturas.repository';
import { FacturasService } from './facturas.service';
import { FoliosOficinaRepository } from './folios-oficina.repository';
import { VentasConsultaRepository } from './ventas-consulta.repository';
import { VentasConsultaService } from './ventas-consulta.service';
import { VentasEdicionRepository } from './ventas-edicion.repository';
import { VentasEdicionService } from './ventas-edicion.service';
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
  controllers: [VentasController, FacturasController, CobranzasController],
  providers: [
    VentasService,
    VentasRepository,
    CobranzasService,
    CobranzasRepository,
    FoliosOficinaRepository,
    VentasPortalService,
    VentasPortalRepository,
    VentasConsultaService,
    VentasConsultaRepository,
    VentasEdicionService,
    VentasEdicionRepository,
    // T-19: asignar factura
    FacturasService,
    FacturasRepository,
    // T-21: cobranza desde el portal
    CobranzasPortalService,
    CobranzasPortalRepository,
  ],
  exports: [VentasService, CobranzasService],
})
export class VentasCobranzaModule {}
