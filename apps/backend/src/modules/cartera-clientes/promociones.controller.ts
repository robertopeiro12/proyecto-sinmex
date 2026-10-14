import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { RequierePermiso } from '../auth/requiere-permiso.decorator';
import { UsuarioActual } from '../auth/usuario-actual.decorator';
import { normalizarSucursalPedida } from '../sucursales/alcance-sucursal';
import { CrearPromocionDto, EditarPromocionDto } from './dto/promocion.dto';
import type { Promocion } from './promociones.repository';
import { PromocionesService } from './promociones.service';

const RE_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// T-74 (D19). Todo con `promocion.gestionar`, lectura incluida: es una pantalla
// de una sola tarea, como Ruta Diaria. El bloque del formulario de cliente solo
// se pinta si el usuario tiene el permiso (portal, Tarea 12).
@Controller('promociones')
export class PromocionesController {
  constructor(private readonly promociones: PromocionesService) {}

  @Get()
  @RequierePermiso('promocion.gestionar')
  listar(
    @UsuarioActual() usuarioId: string,
    @Query('sucursal') sucursal?: string,
    @Query('clienteId') clienteId?: string,
  ): Promise<Promocion[]> {
    const cliente = clienteId?.trim() || null;
    // Postgres compararia un texto invalido con uuid y daria 500.
    if (cliente !== null && !RE_UUID.test(cliente)) {
      throw new BadRequestException('El cliente no es válido.');
    }
    return this.promociones.listar(
      usuarioId,
      normalizarSucursalPedida(sucursal),
      cliente,
    );
  }

  @Post()
  @RequierePermiso('promocion.gestionar')
  crear(
    @UsuarioActual() usuarioId: string,
    @Body() dto: CrearPromocionDto,
  ): Promise<Promocion[]> {
    return this.promociones.crear(usuarioId, dto);
  }

  @Patch(':id')
  @RequierePermiso('promocion.gestionar')
  editar(
    @UsuarioActual() usuarioId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EditarPromocionDto,
  ): Promise<Promocion> {
    return this.promociones.editar(usuarioId, id, dto);
  }
}
