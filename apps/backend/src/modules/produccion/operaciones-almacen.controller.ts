import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { UsuarioActual } from '../auth/usuario-actual.decorator';
import {
  ConsultaOperacionesDto,
  CrearOperacionDto,
  EditarOperacionDto,
} from './dto/operacion-almacen.dto';
import {
  OperacionesAlmacenService,
  type OperacionAlmacen,
  type OperacionesDelDia,
} from './operaciones-almacen.service';

// Registro de Operacion (parte 1). Un solo recurso para los cinco tipos: aqui no
// hay `@RequierePermiso` porque el permiso depende del tipo (`operacion.entrada`,
// `.envio`, `.merma`, `.consumo`, `.descuento`) y lo exige el servicio en cada
// ruta, con la misma resolucion que el guard (`PermisosRepository`).
@Controller('operaciones-almacen')
export class OperacionesAlmacenController {
  constructor(private readonly operaciones: OperacionesAlmacenService) {}

  @Get()
  listar(
    @UsuarioActual() usuarioId: string,
    @Query() q: ConsultaOperacionesDto,
  ): Promise<OperacionesDelDia> {
    return this.operaciones.listar(usuarioId, q);
  }

  @Get(':id')
  leer(
    @UsuarioActual() usuarioId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<OperacionAlmacen> {
    return this.operaciones.leer(usuarioId, id);
  }

  @Post()
  crear(
    @UsuarioActual() usuarioId: string,
    @Body() dto: CrearOperacionDto,
  ): Promise<OperacionAlmacen> {
    return this.operaciones.crear(usuarioId, dto);
  }

  @Put(':id')
  editar(
    @UsuarioActual() usuarioId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EditarOperacionDto,
  ): Promise<OperacionAlmacen> {
    return this.operaciones.editar(usuarioId, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  async eliminar(
    @UsuarioActual() usuarioId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.operaciones.eliminar(usuarioId, id);
  }
}
