import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { UsuarioActual } from '../auth/usuario-actual.decorator';
import { RequierePermiso } from '../auth/requiere-permiso.decorator';
import { normalizarSucursalPedida } from '../sucursales/alcance-sucursal';
import { ClientesService, normalizarTipoPedido } from './clientes.service';
import { CrearClienteDto } from './dto/crear-cliente.dto';
import type { ClienteDetalle, ClienteResumen } from './clientes.repository';

// Sin @Publico(): el guard global protege todo por defecto. Ni listar ni
// leer el detalle exigen cliente.gestionar (D2 del spec): el candado va
// solo en escritura (Task 6/7), igual que Vehiculos (T-11) y Productos (T-10).
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
}
