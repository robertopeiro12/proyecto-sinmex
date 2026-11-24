import { Controller, Get, Query } from '@nestjs/common';
import { RequierePermiso } from '../auth/requiere-permiso.decorator';
import { UsuarioActual } from '../auth/usuario-actual.decorator';
import { ConsultaInventarioVendedorDto } from './dto/inventario-vendedor.dto';
import {
  InventarioVendedorService,
  type InventarioVendedor,
} from './inventario-vendedor.service';

// Produccion -> Inventario por vendedor: solo lectura, permiso `inventario.ver`
// (ya sembrado, "Informacion de inventario"). El alcance de sucursal lo
// resuelve el servicio.
@Controller('inventario-vendedor')
export class InventarioVendedorController {
  constructor(private readonly inventario: InventarioVendedorService) {}

  @Get()
  @RequierePermiso('inventario.ver')
  leer(
    @UsuarioActual() usuarioId: string,
    @Query() q: ConsultaInventarioVendedorDto,
  ): Promise<InventarioVendedor> {
    return this.inventario.leer(usuarioId, q);
  }
}
