import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CarteraClientesModule } from '../cartera-clientes/cartera-clientes.module';
import { ProduccionModule } from '../produccion/produccion.module';
import { RutasModule } from '../rutas/rutas.module';
import { MovimientosRepository } from './movimientos.repository';
import { MovimientosService } from './movimientos.service';
import { ProcesosController } from './procesos.controller';
import { ProcesosRepository } from './procesos.repository';
import { ProcesosService } from './procesos.service';
import { ProductosController } from './productos.controller';
import { ProductosRepository } from './productos.repository';
import { ProductosService } from './productos.service';

// Productos vive aqui y no en un `modules/productos/` nuevo: el CLAUDE.md fija
// que los modulos usan los slugs del vault, y `Producto.md` declara
// `modulo: inventario` (D3).
//
// T-27 pieza 2: los movimientos de inventario (merma y consumo). Exporta
// `MovimientosService` para que sincronizacion/ proyecte el `tipo: 'movimiento'`
// (ADR-0009: sincronizacion importa a los modulos de dominio, nunca al reves).
//
// Operacion -> Procesos (PR A): merma, cambios, consumos, promocion y
// descuentos que captura la oficina (tablas `proceso_oficina*`), solo para el
// portal. Importa `AuthModule` para exigir el permiso del tipo con
// `PermisosRepository`. Lee el corte (`ProduccionModule`) para precargar
// descuentos, las notas con saldo (`RutasModule`) y las promociones vigentes
// (`CarteraClientesModule`) para el resumen del cliente. Ninguno de los tres
// importa a Inventario: no hay ciclo.
@Module({
  imports: [AuthModule, ProduccionModule, RutasModule, CarteraClientesModule],
  controllers: [ProductosController, ProcesosController],
  providers: [
    ProductosService,
    ProductosRepository,
    MovimientosService,
    MovimientosRepository,
    ProcesosService,
    ProcesosRepository,
  ],
  exports: [MovimientosService],
})
export class InventarioModule {}
