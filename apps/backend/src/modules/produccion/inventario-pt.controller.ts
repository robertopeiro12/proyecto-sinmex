import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Put,
  Query,
} from '@nestjs/common';
import { RequierePermiso } from '../auth/requiere-permiso.decorator';
import { UsuarioActual } from '../auth/usuario-actual.decorator';
import {
  BorrarAjustePtDto,
  ConsultaAjustesPtDto,
  ConsultaDescuentosPtDto,
  ConsultaHistorialPtDto,
  ConsultaInventarioPtDto,
  GuardarAjustesPtDto,
} from './dto/inventario-pt.dto';
import {
  InventarioPtService,
  type AjustesPt,
  type DescuentosPt,
  type HistorialPt,
  type InventarioPt,
} from './inventario-pt.service';

// Produccion -> Inventario de PT con Ventas: lectura con `inventario_pt.ver`,
// ajustes ("borron y cuenta nueva") con `inventario_pt.ajustar` (los dos del
// grupo Produccion/Almacen). El alcance de sucursal lo resuelve el servicio.
@Controller('inventario-pt')
export class InventarioPtController {
  constructor(private readonly inventario: InventarioPtService) {}

  @Get()
  @RequierePermiso('inventario_pt.ver')
  leer(
    @UsuarioActual() usuarioId: string,
    @Query() q: ConsultaInventarioPtDto,
  ): Promise<InventarioPt> {
    return this.inventario.leer(usuarioId, q);
  }

  @Get('historial')
  @RequierePermiso('inventario_pt.ver')
  historial(
    @UsuarioActual() usuarioId: string,
    @Query() q: ConsultaHistorialPtDto,
  ): Promise<HistorialPt> {
    return this.inventario.historial(usuarioId, q);
  }

  @Get('descuentos')
  @RequierePermiso('inventario_pt.ver')
  descuentos(
    @UsuarioActual() usuarioId: string,
    @Query() q: ConsultaDescuentosPtDto,
  ): Promise<DescuentosPt> {
    return this.inventario.descuentos(usuarioId, q);
  }

  @Get('ajustes')
  @RequierePermiso('inventario_pt.ajustar')
  ajustes(
    @UsuarioActual() usuarioId: string,
    @Query() q: ConsultaAjustesPtDto,
  ): Promise<AjustesPt> {
    return this.inventario.ajustesDelDia(usuarioId, q);
  }

  @Put('ajustes')
  @HttpCode(204)
  @RequierePermiso('inventario_pt.ajustar')
  async guardarAjustes(
    @UsuarioActual() usuarioId: string,
    @Body() dto: GuardarAjustesPtDto,
  ): Promise<void> {
    await this.inventario.guardarAjustes(usuarioId, dto);
  }

  @Delete('ajustes')
  @HttpCode(204)
  @RequierePermiso('inventario_pt.ajustar')
  async borrarAjuste(
    @UsuarioActual() usuarioId: string,
    @Query() q: BorrarAjustePtDto,
  ): Promise<void> {
    await this.inventario.borrarAjuste(usuarioId, q);
  }
}
