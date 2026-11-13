import { Body, Controller, Get, Put, Query } from '@nestjs/common';
import { RequierePermiso } from '../auth/requiere-permiso.decorator';
import { UsuarioActual } from '../auth/usuario-actual.decorator';
import {
  ConsultaCorteVendedorDto,
  ConsultaCortesDto,
  GuardarCorteDto,
} from './dto/corte.dto';
import {
  CortesService,
  type CorteVendedor,
  type CortesDelDia,
} from './cortes.service';

// Corte de mercancia (Produccion -> Corte; absorbe a Retorno): lo captura el
// almacenista con `retorno.gestionar` (ya sembrado, grupo Produccion/Almacen),
// lectura incluida. El alcance de sucursal lo resuelve el servicio.
@Controller('cortes')
export class CortesController {
  constructor(private readonly cortes: CortesService) {}

  @Get()
  @RequierePermiso('retorno.gestionar')
  lista(
    @UsuarioActual() usuarioId: string,
    @Query() q: ConsultaCortesDto,
  ): Promise<CortesDelDia> {
    return this.cortes.lista(usuarioId, q);
  }

  @Get('vendedor')
  @RequierePermiso('retorno.gestionar')
  leer(
    @UsuarioActual() usuarioId: string,
    @Query() q: ConsultaCorteVendedorDto,
  ): Promise<CorteVendedor> {
    return this.cortes.leer(usuarioId, q);
  }

  @Put('vendedor')
  @RequierePermiso('retorno.gestionar')
  guardar(
    @UsuarioActual() usuarioId: string,
    @Body() dto: GuardarCorteDto,
  ): Promise<CorteVendedor> {
    return this.cortes.guardar(usuarioId, dto);
  }
}
