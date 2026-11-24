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
import { RequierePermiso } from '../auth/requiere-permiso.decorator';
import { UsuarioActual } from '../auth/usuario-actual.decorator';
import {
  ConsultaOperacionesDto,
  ConsultaRetirosPendientesDto,
  RechazarRetiroDto,
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
// ruta, con la misma resolucion que el guard (`PermisosRepository`). El retiro de
// merma (parte 2) se pide con `operacion.retiro_merma`; autorizarlo o rechazarlo
// es de Administracion (`peticiones.gestionar`, con `@RequierePermiso`).
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

  @Get('retiros-pendientes')
  @RequierePermiso('peticiones.gestionar')
  retirosPendientes(
    @UsuarioActual() usuarioId: string,
    @Query() q: ConsultaRetirosPendientesDto,
  ): Promise<{ retiros: OperacionAlmacen[] }> {
    return this.operaciones.retirosPendientes(usuarioId, q.sucursal);
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

  @Post(':id/autorizar')
  @HttpCode(200)
  @RequierePermiso('peticiones.gestionar')
  autorizar(
    @UsuarioActual() usuarioId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<OperacionAlmacen> {
    return this.operaciones.autorizarRetiro(usuarioId, id);
  }

  @Post(':id/rechazar')
  @HttpCode(200)
  @RequierePermiso('peticiones.gestionar')
  rechazar(
    @UsuarioActual() usuarioId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RechazarRetiroDto,
  ): Promise<OperacionAlmacen> {
    return this.operaciones.rechazarRetiro(usuarioId, id, dto.motivo);
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
