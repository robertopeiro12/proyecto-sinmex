import { Body, Controller, Get, Patch, Query } from '@nestjs/common';
import { UsuarioActual } from '../auth/usuario-actual.decorator';
import { RequierePermiso } from '../auth/requiere-permiso.decorator';
import { normalizarSucursalPedida } from '../sucursales/alcance-sucursal';
import { PreciosService } from './precios.service';
import { ActualizarPrecioDto } from './dto/actualizar-precio.dto';
import type { PrecioVigente } from './precios.repository';

@Controller('precios')
export class PreciosController {
  constructor(private readonly precios: PreciosService) {}

  @Get()
  async listar(
    @UsuarioActual() usuarioId: string,
    @Query('sucursal') sucursal?: string,
  ): Promise<PrecioVigente[]> {
    return this.precios.listarVigentes(
      usuarioId,
      normalizarSucursalPedida(sucursal),
    );
  }

  @Patch()
  @RequierePermiso('precio.gestionar')
  async actualizar(
    @UsuarioActual() usuarioId: string,
    @Body() dto: ActualizarPrecioDto,
  ): Promise<PrecioVigente> {
    return this.precios.actualizar(usuarioId, dto);
  }
}
