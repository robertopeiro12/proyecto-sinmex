import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
} from '@nestjs/common';
import { SoloApp } from '../auth/solo-app.decorator';
import { VendedorActual } from '../auth/vendedor-actual.decorator';
import type { RespuestaPull, RespuestaPush } from './contrato';
import { PullDto, PushDto } from './dto/sincronizacion.dto';
import { SincronizacionService } from './sincronizacion.service';

/**
 * Sincronizacion de la [[App Tablet]] (T-07).
 *
 * > [!danger] `@SoloApp()` en los dos endpoints
 * > Estos son endpoints de la **app**, no del portal. El guard global exige
 * > `Authorization: Bearer` con un JWT de `tipo: 'vendedor'`; una cookie del
 * > portal no entra ni aunque sea de un administrador. Ver T-06 y el guard.
 *
 * > [!info] `sincronizacion` no es un slug de dominio del vault
 * > Es el segundo modulo del backend que no corresponde a uno de los 12 modulos
 * > de negocio (el primero fue `sucursales` en T-09): la sincronizacion los
 * > atraviesa todos. Anotado tambien en el `CLAUDE.md` del repo.
 */
@Controller('sync')
export class SincronizacionController {
  constructor(private readonly sync: SincronizacionService) {}

  /**
   * Lo que la tablet baja antes de salir a ruta (y en el refresco de media
   * manana): catalogos de su sucursal, precios ya resueltos por cliente y
   * notas pendientes por cobrar.
   *
   * Es **incremental**: con `?desde=<cursor del pull anterior>` solo bajan las
   * filas que cambiaron. Sin `desde`, vuelco completo — que es lo que hace una
   * tablet recien instalada.
   */
  @SoloApp()
  @Get('pull')
  async pull(
    @VendedorActual() vendedorId: string,
    @Query() dto: PullDto,
  ): Promise<RespuestaPull> {
    return this.sync.pull(vendedorId, dto);
  }

  /**
   * Lo que la tablet sube al volver al WiFi: la operacion del dia, por lotes.
   *
   * Responde **200 aunque haya operaciones rechazadas**: el estado HTTP habla
   * del lote (lo recibi y lo procese), y el detalle por operacion va en el
   * cuerpo. Un 4xx aqui obligaria a la tablet a adivinar si reintentar el lote
   * entero, que es como se duplican operaciones.
   */
  @SoloApp()
  @Post('push')
  @HttpCode(HttpStatus.OK)
  async push(
    @VendedorActual() vendedorId: string,
    @Body() dto: PushDto,
  ): Promise<RespuestaPush> {
    return this.sync.push(vendedorId, dto);
  }
}
