import { Controller, Get, Query } from '@nestjs/common';
import { RequierePermiso } from '../auth/requiere-permiso.decorator';
import { UsuarioActual } from '../auth/usuario-actual.decorator';
import {
  ConsultaDetalleInformacionProduccionDto,
  ConsultaInformacionProduccionDto,
} from './dto/informacion-produccion.dto';
import {
  InformacionProduccionService,
  type DetalleInformacionProduccion,
  type InformacionProduccion,
} from './informacion-produccion.service';

// Produccion -> Informacion de Produccion: reporte de solo lectura de las
// Entradas/Compras del Registro de Operacion. Permiso propio
// `informacion_produccion.ver` (grupo Produccion/Almacen); el alcance de
// sucursal lo resuelve el servicio.
@Controller('informacion-produccion')
export class InformacionProduccionController {
  constructor(private readonly informacion: InformacionProduccionService) {}

  @Get()
  @RequierePermiso('informacion_produccion.ver')
  leer(
    @UsuarioActual() usuarioId: string,
    @Query() q: ConsultaInformacionProduccionDto,
  ): Promise<InformacionProduccion> {
    return this.informacion.leer(usuarioId, q);
  }

  @Get('detalle')
  @RequierePermiso('informacion_produccion.ver')
  detalle(
    @UsuarioActual() usuarioId: string,
    @Query() q: ConsultaDetalleInformacionProduccionDto,
  ): Promise<DetalleInformacionProduccion> {
    return this.informacion.detalle(usuarioId, q);
  }
}
