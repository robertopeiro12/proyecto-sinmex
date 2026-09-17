import { Module } from '@nestjs/common';
import { CarteraClientesModule } from '../cartera-clientes/cartera-clientes.module';
import { VentasCobranzaModule } from '../ventas-cobranza/ventas-cobranza.module';
import { SincronizacionController } from './sincronizacion.controller';
import { SincronizacionRepository } from './sincronizacion.repository';
import { SincronizacionService } from './sincronizacion.service';

// ADR-0009: sincronizacion importa a los modulos de dominio que proyectan cada
// `tipo`, nunca al reves. Si un modulo de dominio necesitara algo de aqui, algo
// estaria en el sitio equivocado.
@Module({
  // T-40 suma Cartera de Clientes: es la duena de `cliente` y por tanto la que
  // proyecta el `tipo: 'prospecto'`.
  imports: [VentasCobranzaModule, CarteraClientesModule],
  controllers: [SincronizacionController],
  providers: [SincronizacionService, SincronizacionRepository],
})
export class SincronizacionModule {}
