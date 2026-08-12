import { Module } from '@nestjs/common';
import { ProductosController } from './productos.controller';
import { ProductosRepository } from './productos.repository';
import { ProductosService } from './productos.service';

// Productos vive aqui y no en un `modules/productos/` nuevo: el CLAUDE.md fija
// que los modulos usan los slugs del vault, y `Producto.md` declara
// `modulo: inventario` (D3).
@Module({
  controllers: [ProductosController],
  providers: [ProductosService, ProductosRepository],
})
export class InventarioModule {}
