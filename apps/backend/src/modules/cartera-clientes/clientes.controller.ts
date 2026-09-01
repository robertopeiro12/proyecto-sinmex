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
import { UsuarioActual } from '../auth/usuario-actual.decorator';
import { RequierePermiso } from '../auth/requiere-permiso.decorator';
import { normalizarSucursalPedida } from '../sucursales/alcance-sucursal';
import { ClientesService, normalizarTipoPedido } from './clientes.service';
import { CrearClienteDto } from './dto/crear-cliente.dto';
import { EditarClienteDto } from './dto/editar-cliente.dto';
import type { ClienteDetalle, ClienteResumen } from './clientes.repository';

// Sin @Publico(): el guard global protege todo por defecto. Ni listar ni
// leer el detalle exigen cliente.gestionar (D2 del spec): el candado va
// solo en los endpoints de escritura (crear/editar/eliminar), igual que
// Vehiculos (T-11) y Productos (T-10).
@Controller('clientes')
export class ClientesController {
  constructor(private readonly clientes: ClientesService) {}

  @Get()
  async listar(
    @UsuarioActual() usuarioId: string,
    @Query('sucursal') sucursal?: string,
    @Query('tipo') tipo?: string,
  ): Promise<ClienteResumen[]> {
    return this.clientes.listar(
      usuarioId,
      normalizarSucursalPedida(sucursal),
      normalizarTipoPedido(tipo),
    );
  }

  @Get(':id')
  async obtener(
    @UsuarioActual() usuarioId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ClienteDetalle> {
    return this.clientes.obtener(usuarioId, id);
  }

  @Post()
  @RequierePermiso('cliente.gestionar')
  async crear(
    @UsuarioActual() usuarioId: string,
    @Body() dto: CrearClienteDto,
  ): Promise<ClienteDetalle> {
    return this.clientes.crear(usuarioId, dto);
  }

  @Patch(':id')
  @RequierePermiso('cliente.gestionar')
  async editar(
    @UsuarioActual() usuarioId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EditarClienteDto,
  ): Promise<ClienteDetalle> {
    return this.clientes.editar(usuarioId, id, dto);
  }

  @Delete(':id')
  @RequierePermiso('cliente.gestionar')
  async eliminar(
    @UsuarioActual() usuarioId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ id: string }> {
    await this.clientes.eliminar(usuarioId, id);
    return { id };
  }

  // Un solo sentido (Prospecto -> Cliente): sin cuerpo, la accion es fija.
  @Post(':id/convertir-a-cliente')
  @RequierePermiso('cliente.gestionar')
  async convertirACliente(
    @UsuarioActual() usuarioId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ClienteDetalle> {
    return this.clientes.convertirACliente(usuarioId, id);
  }
}
