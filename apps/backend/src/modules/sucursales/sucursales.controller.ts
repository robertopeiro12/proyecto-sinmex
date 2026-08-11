import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { UsuarioActual } from '../auth/usuario-actual.decorator';
import { RequierePermiso } from '../auth/requiere-permiso.decorator';
import { normalizarSucursalPedida } from './alcance-sucursal';
import { CrearSucursalDto } from './dto/crear-sucursal.dto';
import { EditarSucursalDto } from './dto/editar-sucursal.dto';
import { SucursalesService } from './sucursales.service';
import type { Sucursal } from './sucursales.repository';

// Sin @Publico(): el guard global de app.module.ts protege todo por defecto.
// Ademas, crear y editar exigen `sucursal.gestionar` (T-08a). Listar NO lo
// exige a proposito: el selector "Por sucursal" de T-09 vive en la barra
// lateral de todas las paginas y lo usa cualquier usuario para trabajar. El
// alcance de lo que cada quien VE ya lo acota alcance-sucursal.ts.
@Controller('sucursales')
export class SucursalesController {
  constructor(private readonly sucursales: SucursalesService) {}

  @Get()
  async listar(
    @UsuarioActual() usuarioId: string,
    @Query('sucursal') sucursal?: string,
  ): Promise<Sucursal[]> {
    return this.sucursales.listar(
      usuarioId,
      normalizarSucursalPedida(sucursal),
    );
  }

  @Post()
  @RequierePermiso('sucursal.gestionar')
  async crear(@Body() dto: CrearSucursalDto): Promise<Sucursal> {
    return this.sucursales.crear(dto);
  }

  @Patch(':id')
  @RequierePermiso('sucursal.gestionar')
  async editar(
    @UsuarioActual() usuarioId: string,
    // ParseUUIDPipe convierte un id mal formado en 400. Sin el, la cadena
    // llegaria a Postgres y saldria como 500.
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EditarSucursalDto,
  ): Promise<Sucursal> {
    return this.sucursales.editar(usuarioId, id, dto);
  }
}
