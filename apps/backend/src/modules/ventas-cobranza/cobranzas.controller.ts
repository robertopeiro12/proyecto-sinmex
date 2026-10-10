import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { RequierePermiso } from '../auth/requiere-permiso.decorator';
import { UsuarioActual } from '../auth/usuario-actual.decorator';
import type { NotaPorCobrar } from './cobranzas-portal.repository';
import {
  CobranzasPortalService,
  type ClientePorCobrar,
  type CobroRegistrado,
} from './cobranzas-portal.service';
import type { PlanDeCobro } from './cobranzas.service';
import {
  AplicarSaldoFavorDto,
  PorCobrarDto,
  RegistrarCobroDto,
  VistaPreviaCobroDto,
} from './dto/cobranzas.dto';

// T-21. Todo con `cobranza.registrar`, lectura incluida: es una pantalla de
// una sola tarea (mismo criterio que facturas). La cuenta perdida NO vive
// aqui: reusa `POST /ventas/:id/cuenta-perdida` con su permiso.
@Controller('cobranzas')
export class CobranzasController {
  constructor(private readonly cobranzas: CobranzasPortalService) {}

  @Get('por-cobrar')
  @RequierePermiso('cobranza.registrar')
  porCobrar(
    @UsuarioActual() usuarioId: string,
    @Query() q: PorCobrarDto,
  ): Promise<ClientePorCobrar | NotaPorCobrar[]> {
    return this.cobranzas.porCobrar(usuarioId, q);
  }

  @Post('vista-previa')
  @HttpCode(200)
  @RequierePermiso('cobranza.registrar')
  vistaPrevia(
    @UsuarioActual() usuarioId: string,
    @Body() dto: VistaPreviaCobroDto,
  ): Promise<PlanDeCobro> {
    return this.cobranzas.vistaPrevia(usuarioId, dto);
  }

  @Post()
  @RequierePermiso('cobranza.registrar')
  registrar(
    @UsuarioActual() usuarioId: string,
    @Body() dto: RegistrarCobroDto,
  ): Promise<CobroRegistrado> {
    return this.cobranzas.registrar(usuarioId, dto);
  }

  @Post('saldo-favor')
  @RequierePermiso('cobranza.registrar')
  aplicarSaldoFavor(
    @UsuarioActual() usuarioId: string,
    @Body() dto: AplicarSaldoFavorDto,
  ): Promise<CobroRegistrado> {
    return this.cobranzas.aplicarSaldoFavor(usuarioId, dto);
  }
}
