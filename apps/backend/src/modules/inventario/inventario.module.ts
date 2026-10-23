import { Module } from '@nestjs/common';
import { MovimientosRepository } from './movimientos.repository';
import { MovimientosService } from './movimientos.service';
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
@Module({
  controllers: [ProductosController],
  providers: [
    ProductosService,
    ProductosRepository,
    MovimientosService,
    MovimientosRepository,
  ],
  exports: [MovimientosService],
})
export class InventarioModule {}
