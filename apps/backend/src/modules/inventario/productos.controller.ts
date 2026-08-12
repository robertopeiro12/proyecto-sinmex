import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { RequierePermiso } from '../auth/requiere-permiso.decorator';
import { CrearProductoDto } from './dto/crear-producto.dto';
import { EditarProductoDto } from './dto/editar-producto.dto';
import { ProductosService } from './productos.service';
import type { Producto } from './productos.repository';

// Sin @Publico(): el guard global protege todo por defecto. Crear exige
// `producto.gestionar` (sembrado desde T-05, grupo General). Listar NO lo
// exige a proposito: el catalogo de sabores lo van a necesitar Ventas,
// Inventario y Cartera, no solo quien administra el catalogo (D5).
//
// Tampoco lleva `?sucursal=`: el catalogo es de la empresa y `resolverAlcance()`
// no aplica (D4). No es un olvido.
@Controller('productos')
export class ProductosController {
  constructor(private readonly productos: ProductosService) {}

  @Get()
  async listar(): Promise<Producto[]> {
    return this.productos.listar();
  }

  @Post()
  @RequierePermiso('producto.gestionar')
  async crear(@Body() dto: CrearProductoDto): Promise<Producto> {
    return this.productos.crear(dto);
  }

  @Patch(':id')
  @RequierePermiso('producto.gestionar')
  async editar(
    // ParseUUIDPipe convierte un id mal formado en 400. Sin el, la cadena
    // llegaria a Postgres y saldria como 500 (mismo motivo que en T-09).
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EditarProductoDto,
  ): Promise<Producto> {
    return this.productos.editar(id, dto);
  }
}
