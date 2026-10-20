import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { RequierePermiso } from '../auth/requiere-permiso.decorator';
import { UsuarioActual } from '../auth/usuario-actual.decorator';
import {
  ConsultaCargasDto,
  CrearCargaDto,
  EditarCargaDto,
  VersionCargaDto,
} from './dto/cargas.dto';
import { CargasService } from './cargas.service';
import type { CargaRejilla, Rejilla } from './reglas-carga';

// T-27 (D1). Produccion › Recarga: todo con `carga.gestionar` (ya sembrado en el
// grupo Produccion/Almacen), lectura incluida, como las demas pantallas de una
// sola tarea. El alcance de sucursal lo resuelve el servicio (otra = 404).
@Controller('cargas')
export class CargasController {
  constructor(private readonly cargas: CargasService) {}

  @Get()
  @RequierePermiso('carga.gestionar')
  rejilla(
    @UsuarioActual() usuarioId: string,
    @Query() q: ConsultaCargasDto,
  ): Promise<Rejilla> {
    return this.cargas.rejilla(usuarioId, q);
  }

  @Post()
  @RequierePermiso('carga.gestionar')
  crear(
    @UsuarioActual() usuarioId: string,
    @Body() dto: CrearCargaDto,
  ): Promise<CargaRejilla> {
    return this.cargas.crear(usuarioId, dto);
  }

  @Patch(':id')
  @RequierePermiso('carga.gestionar')
  editar(
    @UsuarioActual() usuarioId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EditarCargaDto,
  ): Promise<CargaRejilla> {
    return this.cargas.editar(usuarioId, id, dto);
  }

  @Delete(':id')
  @RequierePermiso('carga.gestionar')
  eliminar(
    @UsuarioActual() usuarioId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VersionCargaDto,
  ): Promise<{ id: string }> {
    return this.cargas.eliminar(usuarioId, id, dto);
  }
}
