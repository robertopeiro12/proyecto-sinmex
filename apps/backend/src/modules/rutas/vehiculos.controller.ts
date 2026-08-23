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
import { normalizarSucursalPedida } from '../sucursales/alcance-sucursal';
import { VehiculosService } from './vehiculos.service';
import { CrearVehiculoDto } from './dto/crear-vehiculo.dto';
import { EditarVehiculoDto } from './dto/editar-vehiculo.dto';
import type { Vehiculo } from './vehiculos.repository';

// Sin @Publico(): el guard global de app.module.ts protege todo por defecto.
// Listar NO exige `vehiculo.gestionar` a proposito: el catalogo lo van a
// necesitar Rutas (T-38) y los reportes de kilometraje, no solo quien lo
// administra. El alcance de lo que cada quien VE ya lo acota
// alcance-sucursal.ts. Crear y editar SI lo exigen (Tasks 3 y 4).
@Controller('vehiculos')
export class VehiculosController {
  constructor(private readonly vehiculos: VehiculosService) {}

  @Get()
  async listar(
    @UsuarioActual() usuarioId: string,
    @Query('sucursal') sucursal?: string,
  ): Promise<Vehiculo[]> {
    return this.vehiculos.listar(usuarioId, normalizarSucursalPedida(sucursal));
  }

  @Post()
  @RequierePermiso('vehiculo.gestionar')
  async crear(
    @UsuarioActual() usuarioId: string,
    @Body() dto: CrearVehiculoDto,
  ): Promise<Vehiculo> {
    return this.vehiculos.crear(usuarioId, dto);
  }

  @Patch(':id')
  @RequierePermiso('vehiculo.gestionar')
  async editar(
    @UsuarioActual() usuarioId: string,
    // ParseUUIDPipe convierte un id mal formado en 400. Sin el, la cadena
    // llegaria a Postgres y saldria como 500 (mismo motivo que T-09 y T-10).
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EditarVehiculoDto,
  ): Promise<Vehiculo> {
    return this.vehiculos.editar(usuarioId, id, dto);
  }
}
