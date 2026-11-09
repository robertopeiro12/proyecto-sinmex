import { Controller, Get, Query } from '@nestjs/common';
import { RequierePermiso } from '../auth/requiere-permiso.decorator';
import { UsuarioActual } from '../auth/usuario-actual.decorator';
import { FlujoDiarioDto } from './dto/flujo-diario.dto';
import { FlujoDiarioService } from './flujo-diario.service';
import type { FlujoDiario } from './reglas-flujo-diario';

// Flujo diario: comparte el permiso del Reporte de Ventas.
@Controller('reportes')
export class FlujoDiarioController {
  constructor(private readonly servicio: FlujoDiarioService) {}

  @Get('flujo-diario')
  @RequierePermiso('reporte_ventas.ver')
  flujoDiario(
    @UsuarioActual() usuarioId: string,
    @Query() q: FlujoDiarioDto,
  ): Promise<FlujoDiario> {
    return this.servicio.flujo(usuarioId, q);
  }
}
