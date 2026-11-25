import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CargasController } from './cargas.controller';
import { CargasRepository } from './cargas.repository';
import { CargasService } from './cargas.service';
import { CortesController } from './cortes.controller';
import { CortesRepository } from './cortes.repository';
import { CortesService } from './cortes.service';
import { MotivosMermaController } from './motivos-merma.controller';
import { MotivosMermaRepository } from './motivos-merma.repository';
import { MotivosMermaService } from './motivos-merma.service';
import { OperacionesAlmacenController } from './operaciones-almacen.controller';
import { OperacionesAlmacenRepository } from './operaciones-almacen.repository';
import { OperacionesAlmacenService } from './operaciones-almacen.service';
import { InventarioVendedorController } from './inventario-vendedor.controller';
import { InventarioVendedorService } from './inventario-vendedor.service';
import { InventarioPtController } from './inventario-pt.controller';
import { InventarioPtRepository } from './inventario-pt.repository';
import { InventarioPtService } from './inventario-pt.service';

// T-27 pieza 1: la carga y las recargas del vendedor (tabla `carga`). Exporta
// `CargasService` para que sincronizacion/ baje las cargas en el pull y atienda
// la respuesta de la tablet (ADR-0009: la dependencia va de sincronizacion hacia
// aqui, nunca al reves).
//
// Registro de Operacion (parte 1): entradas, envios, merma de almacen, consumo y
// descuentos (tablas `operacion_almacen*`), solo para el portal. Reemplaza a la
// produccion por dia de T-25 (`/produccion` se quito). Importa `AuthModule` para
// exigir el permiso del tipo con `PermisosRepository`.
//
// Corte de mercancia (tablas `retorno` y `corte_mercancia`), solo para el
// portal: absorbe a Retorno (`/retornos` se quito). Lee cargas y ventas para
// calcular lo que deberia regresar; no las toca.
//
// Inventario de PT con Ventas (tabla `inventario_pt_ajuste`): solo lectura de
// ventas, Registro de Operacion, Procesos y la tablet, mas los ajustes. La
// merma de los vendedores sale de la cuenta del corte (`movimientosDelRango`).
@Module({
  imports: [AuthModule],
  controllers: [
    CargasController,
    CortesController,
    MotivosMermaController,
    OperacionesAlmacenController,
    InventarioVendedorController,
    InventarioPtController,
  ],
  providers: [
    CargasService,
    CargasRepository,
    CortesService,
    CortesRepository,
    MotivosMermaService,
    MotivosMermaRepository,
    OperacionesAlmacenService,
    OperacionesAlmacenRepository,
    InventarioVendedorService,
    InventarioPtService,
    InventarioPtRepository,
  ],
  exports: [CargasService, CortesService],
})
export class ProduccionModule {}
