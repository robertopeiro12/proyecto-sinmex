import { Controller, Get, Query } from '@nestjs/common';
import { RequierePermiso } from '../auth/requiere-permiso.decorator';
import { UsuarioActual } from '../auth/usuario-actual.decorator';
import {
  ConsultaDetallePtRecargasDto,
  ConsultaInventarioPtRecargasDto,
} from './dto/inventario-pt-recargas.dto';
import {
  InventarioPtRecargasService,
  type DetallePtRecargas,
  type InventarioPtRecargas,
} from './inventario-pt-recargas.service';

// Produccion -> Inventario de PT con Recargas: lectura de hoy con su permiso
// propio `inventario_pt_recargas.ver` (no el de PT con Ventas, R2). Ajustar usa
// los endpoints `/inventario-pt/ajustes` de siempre. Controller aparte: el de
// PT con Ventas no tiene rutas con parametro que capturen `recargas`.
@Controller('inventario-pt/recargas')
export class InventarioPtRecargasController {
  constructor(private readonly inventario: InventarioPtRecargasService) {}

  @Get()
  @RequierePermiso('inventario_pt_recargas.ver')
  leer(
    @UsuarioActual() usuarioId: string,
    @Query() q: ConsultaInventarioPtRecargasDto,
  ): Promise<InventarioPtRecargas> {
    return this.inventario.leer(usuarioId, q);
  }

  @Get('detalle')
  @RequierePermiso('inventario_pt_recargas.ver')
  detalle(
    @UsuarioActual() usuarioId: string,
    @Query() q: ConsultaDetallePtRecargasDto,
  ): Promise<DetallePtRecargas> {
    return this.inventario.detalle(usuarioId, q);
  }
}
