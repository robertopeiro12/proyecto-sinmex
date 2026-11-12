import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Put,
  Query,
} from '@nestjs/common';
import { RequierePermiso } from '../auth/requiere-permiso.decorator';
import { UsuarioActual } from '../auth/usuario-actual.decorator';
import {
  AsignarNotaDto,
  ConsultaNotasDto,
  NotaParamDto,
} from './dto/nota-asignada.dto';
import { NotasAsignadasService } from './notas-asignadas.service';
import type { NotasDeRuta } from './reglas-notas-ruta';

// Notas por cobrar asignadas a un vendedor ese dia (spec §5.4). Mismo permiso
// que la Ruta Diaria, lectura incluida.
@Controller('rutas/diaria/notas')
export class NotasAsignadasController {
  constructor(private readonly notas: NotasAsignadasService) {}

  @Get()
  @RequierePermiso('ruta_diaria.gestionar')
  ver(
    @UsuarioActual() usuarioId: string,
    @Query() q: ConsultaNotasDto,
  ): Promise<NotasDeRuta> {
    return this.notas.ver(usuarioId, q.vendedorId, q.fecha);
  }

  @Put(':ventaNotaId')
  @RequierePermiso('ruta_diaria.gestionar')
  asignar(
    @UsuarioActual() usuarioId: string,
    @Param() p: NotaParamDto,
    @Body() dto: AsignarNotaDto,
  ): Promise<NotasDeRuta> {
    return this.notas.asignar(
      usuarioId,
      p.ventaNotaId,
      dto.vendedorId,
      dto.fecha,
    );
  }

  @Delete(':ventaNotaId')
  @RequierePermiso('ruta_diaria.gestionar')
  quitar(
    @UsuarioActual() usuarioId: string,
    @Param() p: NotaParamDto,
    @Query() q: ConsultaNotasDto,
  ): Promise<NotasDeRuta> {
    return this.notas.quitar(usuarioId, p.ventaNotaId, q.vendedorId, q.fecha);
  }
}
