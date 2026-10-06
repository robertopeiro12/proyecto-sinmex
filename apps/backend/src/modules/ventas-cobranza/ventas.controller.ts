import {
  Body,
  Controller,
  Get,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { RequierePermiso } from '../auth/requiere-permiso.decorator';
import { UsuarioActual } from '../auth/usuario-actual.decorator';
import { RegistrarVentaDto } from './dto/registrar-venta.dto';
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
  constructor(private readonly ventas: VentasPortalService) {}

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
}
