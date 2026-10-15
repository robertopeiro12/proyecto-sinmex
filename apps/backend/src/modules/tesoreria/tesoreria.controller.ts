import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { RequierePermiso } from '../auth/requiere-permiso.decorator';
import { UsuarioActual } from '../auth/usuario-actual.decorator';
import { normalizarSucursalPedida } from '../sucursales/alcance-sucursal';
import {
  CrearCuentaDto,
  GuardarSaldosDto,
  RenombrarCuentaDto,
  SaldosDelDiaDto,
} from './dto/tesoreria.dto';
import type { CuentaEnAlcance } from './reglas-saldo';
import { TesoreriaService, type SaldosDelDia } from './tesoreria.service';

// T-28. `tesoreria.ver` consulta la vista; `tesoreria.gestionar` administra
// cuentas y saldos (spec §2). Listar cuentas pide `gestionar`: la vista trae las
// suyas, y la pestaña Cuentas es de quien administra.
@Controller('tesoreria')
export class TesoreriaController {
  constructor(private readonly tesoreria: TesoreriaService) {}

  @Get('cuentas')
  @RequierePermiso('tesoreria.gestionar')
  listarCuentas(
    @UsuarioActual() usuarioId: string,
    @Query('sucursal') sucursal?: string,
  ): Promise<CuentaEnAlcance[]> {
    return this.tesoreria.listarCuentas(
      usuarioId,
      normalizarSucursalPedida(sucursal),
    );
  }

  @Post('cuentas')
  @RequierePermiso('tesoreria.gestionar')
  crearCuenta(
    @UsuarioActual() usuarioId: string,
    @Body() dto: CrearCuentaDto,
  ): Promise<CuentaEnAlcance> {
    return this.tesoreria.crearCuenta(usuarioId, dto);
  }

  @Patch('cuentas/:id')
  @RequierePermiso('tesoreria.gestionar')
  renombrarCuenta(
    @UsuarioActual() usuarioId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RenombrarCuentaDto,
  ): Promise<CuentaEnAlcance> {
    return this.tesoreria.renombrarCuenta(usuarioId, id, dto);
  }

  @Delete('cuentas/:id')
  @RequierePermiso('tesoreria.gestionar')
  async eliminarCuenta(
    @UsuarioActual() usuarioId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ id: string }> {
    await this.tesoreria.eliminarCuenta(usuarioId, id);
    return { id };
  }

  @Get('saldos')
  @RequierePermiso('tesoreria.gestionar')
  saldosDelDia(
    @UsuarioActual() usuarioId: string,
    @Query() q: SaldosDelDiaDto,
  ): Promise<SaldosDelDia> {
    return this.tesoreria.saldosDelDia(
      usuarioId,
      normalizarSucursalPedida(q.sucursal),
      q.fecha,
    );
  }

  @Put('saldos')
  @RequierePermiso('tesoreria.gestionar')
  guardarSaldos(
    @UsuarioActual() usuarioId: string,
    @Body() dto: GuardarSaldosDto,
  ): Promise<{ guardados: number }> {
    return this.tesoreria.guardarSaldos(usuarioId, dto);
  }

  @Delete('saldos/:id')
  @RequierePermiso('tesoreria.gestionar')
  async eliminarSaldo(
    @UsuarioActual() usuarioId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ id: string }> {
    await this.tesoreria.eliminarSaldo(usuarioId, id);
    return { id };
  }
}
