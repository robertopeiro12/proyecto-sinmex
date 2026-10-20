import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { SoloApp } from '../auth/solo-app.decorator';
import { VendedorActual } from '../auth/vendedor-actual.decorator';
import { CargasService } from '../produccion/cargas.service';
import { RespuestaCargaDto } from '../produccion/dto/cargas.dto';
import type { CargaPull } from './contrato';

/**
 * La respuesta del vendedor a su carga (T-27, D2/D6), junto a las fotos: un canal
 * aparte del lote del push (sin `contrato` ni `resultados[]`), con la misma auth
 * de vendedor. La regla vive en Produccion (`CargasService.responder`, ADR-0009);
 * aqui solo se recibe.
 *
 * Usa el mismo `Authorization: Bearer` que el resto de la app y nunca renueva la
 * sesion por su cuenta: un 401 lo resuelve la tablet sincronizando.
 *
 * 200 y no 201: responder es idempotente (la misma respuesta otra vez devuelve
 * la carga sin reescribirla).
 */
@Controller('sync')
export class CargasAppController {
  constructor(private readonly cargas: CargasService) {}

  @SoloApp()
  @Post('cargas/:id/respuesta')
  @HttpCode(HttpStatus.OK)
  responder(
    @VendedorActual() vendedorId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RespuestaCargaDto,
  ): Promise<CargaPull> {
    return this.cargas.responder(vendedorId, id.toLowerCase(), dto);
  }
}
