import { Body, Controller, Get, Put, Query } from '@nestjs/common';
import { RequierePermiso } from '../auth/requiere-permiso.decorator';
import { UsuarioActual } from '../auth/usuario-actual.decorator';
import {
  ConsultaProduccionDto,
  GuardarProduccionDto,
} from './dto/produccion.dto';
import { ProduccionService, type DiaProduccion } from './produccion.service';

// T-25. Produccion por dia: registrar la produccion es registrar una entrada del
// Almacen General, asi que todo va con `almacen_general.gestionar` (ya sembrado,
// grupo Produccion/Almacen), lectura incluida. El alcance de sucursal lo
// resuelve el servicio (otra = 404).
@Controller('produccion')
export class ProduccionController {
  constructor(private readonly produccion: ProduccionService) {}

  @Get()
  @RequierePermiso('almacen_general.gestionar')
  leer(
    @UsuarioActual() usuarioId: string,
    @Query() q: ConsultaProduccionDto,
  ): Promise<DiaProduccion> {
    return this.produccion.leer(usuarioId, q);
  }

  @Put()
  @RequierePermiso('almacen_general.gestionar')
  guardar(
    @UsuarioActual() usuarioId: string,
    @Body() dto: GuardarProduccionDto,
  ): Promise<DiaProduccion> {
    return this.produccion.guardar(usuarioId, dto);
  }
}
