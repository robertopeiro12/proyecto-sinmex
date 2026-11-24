import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { UsuarioActual } from '../auth/usuario-actual.decorator';
import {
  ConsultaProcesosDto,
  CrearProcesoDto,
  EditarProcesoDto,
} from './dto/proceso.dto';
import {
  ProcesosService,
  type Proceso,
  type ProcesosDelDia,
} from './procesos.service';

// Operacion -> Procesos (PR A). Un solo recurso para los cinco tipos: aqui no
// hay `@RequierePermiso` porque el permiso depende del tipo (`proceso.merma`,
// `.cambio`, `.consumo`, `.promocion`, `.descuento`) y lo exige el servicio en
// cada ruta, con la misma resolucion que el guard (`PermisosRepository`).
@Controller('procesos')
export class ProcesosController {
  constructor(private readonly procesos: ProcesosService) {}

  @Get()
  listar(
    @UsuarioActual() usuarioId: string,
    @Query() q: ConsultaProcesosDto,
  ): Promise<ProcesosDelDia> {
    return this.procesos.listar(usuarioId, q);
  }

  @Post()
  crear(
    @UsuarioActual() usuarioId: string,
    @Body() dto: CrearProcesoDto,
  ): Promise<Proceso> {
    return this.procesos.crear(usuarioId, dto);
  }

  @Patch(':id')
  editar(
    @UsuarioActual() usuarioId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EditarProcesoDto,
  ): Promise<Proceso> {
    return this.procesos.editar(usuarioId, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  async eliminar(
    @UsuarioActual() usuarioId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.procesos.eliminar(usuarioId, id);
  }
}
