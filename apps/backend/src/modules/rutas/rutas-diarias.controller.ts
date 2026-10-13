import { Body, Controller, Get, Put, Query } from '@nestjs/common';
import { RequierePermiso } from '../auth/requiere-permiso.decorator';
import { UsuarioActual } from '../auth/usuario-actual.decorator';
import {
  ConsultaRutaDiariaDto,
  GuardarRutaDiariaDto,
} from './dto/ruta-diaria.dto';
import {
  RutasDiariasService,
  type RutaAnterior,
  type RutaDiaria,
} from './rutas-diarias.service';

// T-37 (D14). Todo con `ruta_diaria.gestionar`, lectura incluida: es una
// pantalla de una sola tarea (mismo criterio que cobranza y facturas). El
// alcance por sucursal lo resuelve el servicio.
@Controller('rutas/diaria')
export class RutasDiariasController {
  constructor(private readonly rutas: RutasDiariasService) {}

  @Get()
  @RequierePermiso('ruta_diaria.gestionar')
  obtener(
    @UsuarioActual() usuarioId: string,
    @Query() q: ConsultaRutaDiariaDto,
  ): Promise<RutaDiaria> {
    return this.rutas.obtenerDiaria(usuarioId, q.vendedorId, q.fecha);
  }

  @Get('anterior')
  @RequierePermiso('ruta_diaria.gestionar')
  anterior(
    @UsuarioActual() usuarioId: string,
    @Query() q: ConsultaRutaDiariaDto,
  ): Promise<RutaAnterior> {
    return this.rutas.anterior(usuarioId, q.vendedorId, q.fecha);
  }

  @Put()
  @RequierePermiso('ruta_diaria.gestionar')
  guardar(
    @UsuarioActual() usuarioId: string,
    @Body() dto: GuardarRutaDiariaDto,
  ): Promise<RutaDiaria> {
    return this.rutas.reemplazarDiaria(usuarioId, dto);
  }
}
