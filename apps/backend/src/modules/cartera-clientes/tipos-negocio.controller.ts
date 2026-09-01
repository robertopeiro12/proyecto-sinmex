import { Body, Controller, Get, Post } from '@nestjs/common';
import { RequierePermiso } from '../auth/requiere-permiso.decorator';
import { TiposNegocioService } from './tipos-negocio.service';
import { CrearTipoNegocioDto } from './dto/crear-tipo-negocio.dto';
import type { TipoNegocio } from './tipos-negocio.repository';

// Sin permiso en el listado (D del spec, "GET /tipos-negocio"): lo necesita
// el desplegable del formulario de Cliente para cualquiera con sesion, igual
// que GET /productos (T-10) y GET /vehiculos (T-11).
@Controller('tipos-negocio')
export class TiposNegocioController {
  constructor(private readonly tiposNegocio: TiposNegocioService) {}

  @Get()
  async listar(): Promise<TipoNegocio[]> {
    return this.tiposNegocio.listar();
  }

  @Post()
  @RequierePermiso('cliente.gestionar')
  async crear(@Body() dto: CrearTipoNegocioDto): Promise<TipoNegocio> {
    return this.tiposNegocio.crear(dto.nombre);
  }
}
