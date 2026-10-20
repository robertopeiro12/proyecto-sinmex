import { Controller, Get, Query } from '@nestjs/common';
import { RequierePermiso } from '../auth/requiere-permiso.decorator';
import { UsuarioActual } from '../auth/usuario-actual.decorator';
import { FlujoEfectivoDto } from './dto/flujo-efectivo.dto';
import {
  FlujoEfectivoService,
  type FlujoEfectivo,
} from './flujo-efectivo.service';

// T-32. Solo lectura; el permiso es `flujo_efectivo.ver`.
@Controller('flujo-efectivo')
export class FlujoEfectivoController {
  constructor(private readonly flujo: FlujoEfectivoService) {}

  @Get()
  @RequierePermiso('flujo_efectivo.ver')
  consultar(
    @UsuarioActual() usuarioId: string,
    @Query() q: FlujoEfectivoDto,
  ): Promise<FlujoEfectivo> {
    return this.flujo.flujo(usuarioId, q);
  }
}
