import { Controller, Get, Query } from '@nestjs/common';
import { RequierePermiso } from '../auth/requiere-permiso.decorator';
import { UsuarioActual } from '../auth/usuario-actual.decorator';
import { DashboardDto, DashboardVendedorDto } from './dto/dashboard.dto';
import { DashboardService } from './dashboard.service';
import type { DetalleVendedorDia } from './reglas-detalle';
import type { Dashboard } from './reglas-flujo-diario';

// El dia no se manda: siempre es hoy de Tijuana.
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
}
