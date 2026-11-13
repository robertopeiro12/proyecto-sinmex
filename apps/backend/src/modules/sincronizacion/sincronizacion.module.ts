import { Module } from '@nestjs/common';
import { ComprasEgresosModule } from '../compras-egresos/compras-egresos.module';
import { CarteraClientesModule } from '../cartera-clientes/cartera-clientes.module';
import { InventarioModule } from '../inventario/inventario.module';
import { ProduccionModule } from '../produccion/produccion.module';
import { RutasModule } from '../rutas/rutas.module';
import { VentasCobranzaModule } from '../ventas-cobranza/ventas-cobranza.module';
import { CargasAppController } from './cargas-app.controller';
import { FotoController } from './foto.controller';
import { FotoRepository } from './foto.repository';
import { FotoService } from './foto.service';
import { SincronizacionController } from './sincronizacion.controller';
import { SincronizacionRepository } from './sincronizacion.repository';
import { SincronizacionService } from './sincronizacion.service';

// ADR-0009: sincronizacion importa a los modulos de dominio que proyectan cada
// `tipo`, nunca al reves. Si un modulo de dominio necesitara algo de aqui, algo
// estaria en el sitio equivocado.
@Module({
  // T-40 suma Cartera de Clientes: es la duena de `cliente` y por tanto la que
  // proyecta el `tipo: 'prospecto'`. T-38 suma Rutas: la duena de la jornada.
  // T-30/T-31 suma Compras y Egresos: la duena de `gasto`.
  imports: [
    VentasCobranzaModule,
    CarteraClientesModule,
    RutasModule,
    ComprasEgresosModule,
    // T-27 suma Produccion: la duena de la carga (pull y respuesta).
    ProduccionModule,
    // T-27 pieza 2 suma Inventario: el dueno de los movimientos (merma y consumo).
    InventarioModule,
  ],
  // T-40 (foto): `FotoController` es un canal aparte del lote del `push` — otro
  // controller, otro servicio, otro repositorio. Comparten el prefijo `sync` y
  // la auth de vendedor, y nada mas: asi un cambio en la foto no puede romper el
  // contrato del push ni al reves.
  controllers: [SincronizacionController, FotoController, CargasAppController],
  providers: [
    SincronizacionService,
    SincronizacionRepository,
    FotoService,
    FotoRepository,
  ],
})
export class SincronizacionModule {}
