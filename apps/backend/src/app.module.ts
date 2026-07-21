import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { VentasCobranzaModule } from './modules/ventas-cobranza/ventas-cobranza.module';
import { TesoreriaModule } from './modules/tesoreria/tesoreria.module';
import { FlujoEfectivoModule } from './modules/flujo-efectivo/flujo-efectivo.module';
import { ComprasEgresosModule } from './modules/compras-egresos/compras-egresos.module';
import { ProduccionModule } from './modules/produccion/produccion.module';
import { InventarioModule } from './modules/inventario/inventario.module';
import { CuentasCobrarPagarModule } from './modules/cuentas-cobrar-pagar/cuentas-cobrar-pagar.module';
import { EstadisticasModule } from './modules/estadisticas/estadisticas.module';
import { CarteraClientesModule } from './modules/cartera-clientes/cartera-clientes.module';
import { NominaComisionesModule } from './modules/nomina-comisiones/nomina-comisiones.module';
import { RutasModule } from './modules/rutas/rutas.module';
import { NotificacionesModule } from './modules/notificaciones/notificaciones.module';
import { HealthModule } from './modules/health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [
        `../../.env.${process.env.NODE_ENV ?? 'development'}`,
        '../../.env',
      ],
    }),
    VentasCobranzaModule,
    TesoreriaModule,
    FlujoEfectivoModule,
    ComprasEgresosModule,
    ProduccionModule,
    InventarioModule,
    CuentasCobrarPagarModule,
    EstadisticasModule,
    CarteraClientesModule,
    NominaComisionesModule,
    RutasModule,
    NotificacionesModule,
    HealthModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
