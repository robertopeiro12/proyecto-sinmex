import { Body, Controller, Get, HttpCode, Put, Query } from '@nestjs/common';
import { RequierePermiso } from '../auth/requiere-permiso.decorator';
import { UsuarioActual } from '../auth/usuario-actual.decorator';
import {
  DashboardDto,
  DashboardVendedorDto,
  NotasEntregadasDto,
} from './dto/dashboard.dto';
import { DashboardService } from './dashboard.service';
import type { DetalleVendedorDia } from './reglas-detalle';
import type { Dashboard } from './reglas-flujo-diario';

// El dia del Dashboard lo pone el servidor (hoy de Tijuana); el detalle acepta
// la fecha del renglon (hoy o ayer), para no cambiar de dia a la medianoche.
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly servicio: DashboardService) {}

  @Get()
  @RequierePermiso('dashboard.ver')
  dashboard(
    @UsuarioActual() usuarioId: string,
    @Query() q: DashboardDto,
  ): Promise<Dashboard> {
    return this.servicio.dashboard(usuarioId, q);
  }

  @Get('vendedor')
  @RequierePermiso('dashboard.ver')
  detalle(
    @UsuarioActual() usuarioId: string,
    @Query() q: DashboardVendedorDto,
  ): Promise<DetalleVendedorDia> {
    return this.servicio.detalle(usuarioId, q);
  }

  /** Casilla "Entregada" de las notas a credito (la nota de papel). */
  @Put('notas-entregadas')
  @HttpCode(204)
  @RequierePermiso('nota_papel.revisar')
  async notasEntregadas(
    @UsuarioActual() usuarioId: string,
    @Body() body: NotasEntregadasDto,
  ): Promise<void> {
    await this.servicio.marcarNotasEntregadas(usuarioId, body);
  }
}
