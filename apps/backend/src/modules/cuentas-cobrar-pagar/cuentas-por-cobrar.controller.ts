import { Controller, Get, Query } from '@nestjs/common';
import { RequierePermiso } from '../auth/requiere-permiso.decorator';
import { UsuarioActual } from '../auth/usuario-actual.decorator';
import { CuentasPorCobrarService } from './cuentas-por-cobrar.service';
import { CuentasPorCobrarDto } from './dto/cuentas-por-cobrar.dto';
import type { CuentasPorCobrar } from './reglas-cuentas-por-cobrar';

// T-22. Solo lectura: cobrar se hace en /cobranzas con su propio permiso.
@Controller('cuentas-por-cobrar')
export class CuentasPorCobrarController {
  constructor(private readonly cuentas: CuentasPorCobrarService) {}

  @Get()
  @RequierePermiso('cuentas_cobrar.ver')
  consultar(
    @UsuarioActual() usuarioId: string,
    @Query() q: CuentasPorCobrarDto,
  ): Promise<CuentasPorCobrar> {
    return this.cuentas.consultar(usuarioId, q);
  }
}
