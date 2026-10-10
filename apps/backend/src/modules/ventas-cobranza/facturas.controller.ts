import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { RequierePermiso } from '../auth/requiere-permiso.decorator';
import { UsuarioActual } from '../auth/usuario-actual.decorator';
import {
  AsignarFacturaDto,
  BuscarFacturasDto,
  PorFacturarDto,
  QuitarVentasDto,
  RenombrarFacturaDto,
} from './dto/facturas.dto';
import type { FacturaConVentas, VentaPorFacturar } from './facturas.repository';
import { FacturasService } from './facturas.service';

// T-19. Todo con `venta.asignar_factura`, lectura incluida: es una pantalla de
// una sola tarea (mismo criterio que `usuario.gestionar`).
@Controller('facturas')
export class FacturasController {
  constructor(private readonly facturas: FacturasService) {}

  @Get('por-facturar')
  @RequierePermiso('venta.asignar_factura')
  porFacturar(
    @UsuarioActual() usuarioId: string,
    @Query() q: PorFacturarDto,
  ): Promise<VentaPorFacturar[]> {
    return this.facturas.porFacturar(
      usuarioId,
      q.clienteId,
      q.incluirNA === 'true',
    );
  }

  @Post('asignar')
  @RequierePermiso('venta.asignar_factura')
  asignar(
    @UsuarioActual() usuarioId: string,
    @Body() dto: AsignarFacturaDto,
  ): Promise<FacturaConVentas> {
    return this.facturas.asignar(usuarioId, dto);
  }

  @Get()
  @RequierePermiso('venta.asignar_factura')
  buscar(
    @UsuarioActual() usuarioId: string,
    @Query() q: BuscarFacturasDto,
  ): Promise<FacturaConVentas[]> {
    return this.facturas.buscar(usuarioId, q);
  }

  @Patch(':id')
  @RequierePermiso('venta.asignar_factura')
  renombrar(
    @UsuarioActual() usuarioId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RenombrarFacturaDto,
  ): Promise<FacturaConVentas> {
    return this.facturas.renombrar(usuarioId, id, dto.numero);
  }

  @Post(':id/quitar')
  @HttpCode(200)
  @RequierePermiso('venta.asignar_factura')
  quitar(
    @UsuarioActual() usuarioId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: QuitarVentasDto,
  ): Promise<{ factura: FacturaConVentas | null }> {
    return this.facturas.quitar(usuarioId, id, dto.ventaIds);
  }
}
