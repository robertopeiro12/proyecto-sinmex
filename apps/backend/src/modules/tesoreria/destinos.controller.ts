import { Body, Controller, Get, Put, Query } from '@nestjs/common';
import { RequierePermiso } from '../auth/requiere-permiso.decorator';
import { UsuarioActual } from '../auth/usuario-actual.decorator';
import { GuardarDestinoDto, ListarDestinosDto } from './dto/destinos.dto';
import { DestinosService, type DestinosSucursal } from './destinos.service';
import type { DestinoCobranza } from './reglas-destino';

// T-29: a que cuenta entra la cobranza, por sucursal y metodo, con fecha "desde".
@Controller('tesoreria/destinos')
export class DestinosController {
  constructor(private readonly destinos: DestinosService) {}

  @Get()
  @RequierePermiso('tesoreria.gestionar')
  listar(
    @UsuarioActual() usuarioId: string,
    @Query() q: ListarDestinosDto,
  ): Promise<DestinosSucursal[]> {
    return this.destinos.listar(usuarioId, q);
  }

  @Put()
  @RequierePermiso('tesoreria.gestionar')
  guardar(
    @UsuarioActual() usuarioId: string,
    @Body() dto: GuardarDestinoDto,
  ): Promise<DestinoCobranza> {
    return this.destinos.guardar(usuarioId, dto);
  }
}
