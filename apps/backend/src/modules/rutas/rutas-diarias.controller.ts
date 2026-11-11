import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Put,
  Query,
} from '@nestjs/common';
import { RequierePermiso } from '../auth/requiere-permiso.decorator';
import { UsuarioActual } from '../auth/usuario-actual.decorator';
import {
  ConsultaDiaDto,
  ConsultaRutaDiariaDto,
  GuardarRutaDiariaDto,
} from './dto/ruta-diaria.dto';
import {
  RutasDiariasService,
  type ListaDelDia,
  type OpcionesDia,
  type RutaDiaria,
} from './rutas-diarias.service';

// Ruta Diaria (T-37, D14; spec §5). Todo con `ruta_diaria.gestionar`, lectura
// incluida: es una pantalla de una sola tarea (mismo criterio que cobranza y
// facturas). El alcance por sucursal lo resuelve el servicio.
@Controller('rutas/diaria')
export class RutasDiariasController {
  constructor(private readonly rutas: RutasDiariasService) {}

  @Get('dia')
  @RequierePermiso('ruta_diaria.gestionar')
  dia(
    @UsuarioActual() usuarioId: string,
    @Query() q: ConsultaDiaDto,
  ): Promise<ListaDelDia> {
    return this.rutas.listaDelDia(usuarioId, q.fecha, q.sucursal);
  }

  @Get('opciones')
  @RequierePermiso('ruta_diaria.gestionar')
  opciones(
    @UsuarioActual() usuarioId: string,
    @Query() q: ConsultaRutaDiariaDto,
  ): Promise<OpcionesDia> {
    return this.rutas.opciones(usuarioId, q.vendedorId, q.fecha);
  }

  @Get()
  @RequierePermiso('ruta_diaria.gestionar')
  obtener(
    @UsuarioActual() usuarioId: string,
    @Query() q: ConsultaRutaDiariaDto,
  ): Promise<RutaDiaria> {
    return this.rutas.obtenerDiaria(usuarioId, q.vendedorId, q.fecha);
  }

  @Put()
  @RequierePermiso('ruta_diaria.gestionar')
  guardar(
    @UsuarioActual() usuarioId: string,
    @Body() dto: GuardarRutaDiariaDto,
  ): Promise<RutaDiaria> {
    return this.rutas.reemplazarDiaria(usuarioId, dto);
  }

  @Delete()
  @HttpCode(204)
  @RequierePermiso('ruta_diaria.gestionar')
  quitar(
    @UsuarioActual() usuarioId: string,
    @Query() q: ConsultaRutaDiariaDto,
  ): Promise<void> {
    return this.rutas.quitarDiaria(usuarioId, q.vendedorId, q.fecha);
  }
}
