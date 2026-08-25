import { Controller, Get } from '@nestjs/common';
import { PreciosService } from './precios.service';
import type { ListaPrecio } from './precios.repository';

// Sin @RequierePermiso(): cualquier pantalla que hable de precios lo va a
// necesitar (T-12, y mas adelante Ventas), no solo quien los administra.
// Mismo criterio que GET /productos (T-10) y GET /vehiculos (T-11).
@Controller('listas-precio')
export class ListasPrecioController {
  constructor(private readonly precios: PreciosService) {}

  @Get()
  async listar(): Promise<ListaPrecio[]> {
    return this.precios.listarListas();
  }
}
