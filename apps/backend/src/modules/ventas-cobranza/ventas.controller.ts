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
import { RequierePermiso } from '../auth/requiere-permiso.decorator';
import { UsuarioActual } from '../auth/usuario-actual.decorator';
import { BuscarVentasDto } from './dto/buscar-ventas.dto';
import { EditarVentaDto } from './dto/editar-venta.dto';
import { RegistrarVentaDto } from './dto/registrar-venta.dto';
import {
  VentasConsultaService,
  type ResultadoBusquedaVentas,
  type VentaDetalle,
} from './ventas-consulta.service';
import { VentasEdicionService } from './ventas-edicion.service';
import type { Repartidor } from './ventas-portal.repository';
import {
  VentasPortalService,
  type PresentacionDeCatalogo,
  type VentaRegistradaPortal,
} from './ventas-portal.service';

// Primer controller de ventas-cobranza (T-17). Sin @Publico(): el guard global
// exige sesion de portal. Las lecturas solo validan alcance; el candado
// `venta.registrar` va en la escritura, como en los catalogos.
@Controller('ventas')
export class VentasController {
  constructor(
    private readonly ventas: VentasPortalService,
    // T-17 parte 2: busqueda y detalle.
    private readonly consulta: VentasConsultaService,
    // T-17 parte 2: editar, eliminar y cuenta perdida.
    private readonly edicion: VentasEdicionService,
  ) {}

  @Get('catalogo')
  async catalogo(
    @UsuarioActual() usuarioId: string,
    @Query('clienteId', ParseUUIDPipe) clienteId: string,
    @Query('fecha') fecha?: string,
  ): Promise<PresentacionDeCatalogo[]> {
    return this.ventas.catalogo(usuarioId, clienteId, fecha);
  }

  @Get('repartidores')
  async repartidores(
    @UsuarioActual() usuarioId: string,
    @Query('sucursalId', ParseUUIDPipe) sucursalId: string,
  ): Promise<Repartidor[]> {
    return this.ventas.repartidores(usuarioId, sucursalId);
  }

  @Post()
  @RequierePermiso('venta.registrar')
  async registrar(
    @UsuarioActual() usuarioId: string,
    @Body() dto: RegistrarVentaDto,
  ): Promise<VentaRegistradaPortal> {
    return this.ventas.registrar(usuarioId, dto);
  }

  /** §3.1: basta la sesion; el alcance lo aplica el servicio. */
  @Get()
  async buscar(
    @UsuarioActual() usuarioId: string,
    @Query() consulta: BuscarVentasDto,
  ): Promise<ResultadoBusquedaVentas> {
    return this.consulta.buscar(usuarioId, consulta);
  }

  @Get(':id')
  async detalle(
    @UsuarioActual() usuarioId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<VentaDetalle> {
    return this.consulta.detalle(usuarioId, id);
  }

  @Patch(':id')
  @RequierePermiso('venta.editar_eliminar')
  async editar(
    @UsuarioActual() usuarioId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EditarVentaDto,
  ): Promise<VentaDetalle> {
    return this.edicion.editar(usuarioId, id, dto);
  }
}
