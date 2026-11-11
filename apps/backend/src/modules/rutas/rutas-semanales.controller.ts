import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { RequierePermiso } from '../auth/requiere-permiso.decorator';
import { UsuarioActual } from '../auth/usuario-actual.decorator';
import {
  ConsultaRutasSemanalesDto,
  CrearRutaSemanalDto,
  GuardarClientesRutaSemanalDto,
  RenombrarRutaSemanalDto,
} from './dto/ruta-semanal.dto';
import {
  RutasSemanalesService,
  type RutaSemanalDetalle,
  type RutaSemanalResumen,
} from './rutas-semanales.service';

// Ruta Semanal (spec §4). Todo con `ruta_semanal.gestionar`, lectura incluida:
// es una pantalla de una sola tarea (mismo criterio que la Ruta Diaria). El
// alcance por sucursal lo resuelve el servicio.
@Controller('rutas/semanales')
export class RutasSemanalesController {
  constructor(private readonly rutas: RutasSemanalesService) {}

  @Get()
  @RequierePermiso('ruta_semanal.gestionar')
  listar(
    @UsuarioActual() usuarioId: string,
    @Query() q: ConsultaRutasSemanalesDto,
  ): Promise<RutaSemanalResumen[]> {
    return this.rutas.listar(usuarioId, q.sucursal);
  }

  @Post()
  @RequierePermiso('ruta_semanal.gestionar')
  crear(
    @UsuarioActual() usuarioId: string,
    @Body() dto: CrearRutaSemanalDto,
  ): Promise<RutaSemanalDetalle> {
    return this.rutas.crear(usuarioId, dto);
  }

  @Get(':id')
  @RequierePermiso('ruta_semanal.gestionar')
  obtener(
    @UsuarioActual() usuarioId: string,
    // ParseUUIDPipe: un id mal formado es 400 y no un 500 de Postgres.
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<RutaSemanalDetalle> {
    return this.rutas.obtener(usuarioId, id);
  }

  @Patch(':id')
  @RequierePermiso('ruta_semanal.gestionar')
  renombrar(
    @UsuarioActual() usuarioId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RenombrarRutaSemanalDto,
  ): Promise<RutaSemanalDetalle> {
    return this.rutas.renombrar(usuarioId, id, dto);
  }

  @Put(':id/clientes')
  @RequierePermiso('ruta_semanal.gestionar')
  guardarClientes(
    @UsuarioActual() usuarioId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: GuardarClientesRutaSemanalDto,
  ): Promise<RutaSemanalDetalle> {
    return this.rutas.guardarClientes(usuarioId, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequierePermiso('ruta_semanal.gestionar')
  eliminar(
    @UsuarioActual() usuarioId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.rutas.eliminar(usuarioId, id);
  }
}
