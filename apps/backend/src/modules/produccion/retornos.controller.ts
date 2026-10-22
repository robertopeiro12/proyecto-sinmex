import { Body, Controller, Get, Put, Query } from '@nestjs/common';
import { RequierePermiso } from '../auth/requiere-permiso.decorator';
import { UsuarioActual } from '../auth/usuario-actual.decorator';
import { ConsultaRetornoDto, GuardarRetornoDto } from './dto/retorno.dto';
import { RetornosService, type DiaRetorno } from './retornos.service';

// Retorno del vendedor: lo captura el almacenista con `retorno.gestionar` (ya
// sembrado, grupo Produccion/Almacen), lectura incluida. El alcance de sucursal
// va por el vendedor y lo resuelve el servicio (otra = 404).
@Controller('retornos')
export class RetornosController {
  constructor(private readonly retornos: RetornosService) {}

  @Get()
  @RequierePermiso('retorno.gestionar')
  leer(
    @UsuarioActual() usuarioId: string,
    @Query() q: ConsultaRetornoDto,
  ): Promise<DiaRetorno> {
    return this.retornos.leer(usuarioId, q);
  }

  @Put()
  @RequierePermiso('retorno.gestionar')
  guardar(
    @UsuarioActual() usuarioId: string,
    @Body() dto: GuardarRetornoDto,
  ): Promise<DiaRetorno> {
    return this.retornos.guardar(usuarioId, dto);
  }
}
