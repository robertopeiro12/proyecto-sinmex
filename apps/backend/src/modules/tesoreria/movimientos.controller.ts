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
  CrearMovimientoDto,
  EditarMovimientoDto,
  ListarMovimientosDto,
} from './dto/movimientos.dto';
import { MovimientosService } from './movimientos.service';
import type { MovimientoManual } from './reglas-saldo';

// T-29: registrar operacion (depositos, retiros, traspasos). Todo con
// `tesoreria.gestionar`; la vista los muestra con `tesoreria.ver`.
@Controller('tesoreria/movimientos')
export class MovimientosController {
  constructor(private readonly movimientos: MovimientosService) {}

  @Get()
  @RequierePermiso('tesoreria.gestionar')
  listar(
    @UsuarioActual() usuarioId: string,
    @Query() q: ListarMovimientosDto,
  ): Promise<MovimientoManual[]> {
    return this.movimientos.listar(usuarioId, q);
  }

  @Post()
  @RequierePermiso('tesoreria.gestionar')
  crear(
    @UsuarioActual() usuarioId: string,
    @Body() dto: CrearMovimientoDto,
  ): Promise<MovimientoManual> {
    return this.movimientos.crear(usuarioId, dto);
  }

  @Patch(':id')
  @RequierePermiso('tesoreria.gestionar')
  editar(
    @UsuarioActual() usuarioId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EditarMovimientoDto,
  ): Promise<MovimientoManual> {
    return this.movimientos.editar(usuarioId, id, dto);
  }

  @Delete(':id')
  @RequierePermiso('tesoreria.gestionar')
  async eliminar(
    @UsuarioActual() usuarioId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ id: string }> {
    await this.movimientos.eliminar(usuarioId, id);
    return { id };
  }
}
