import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { RequierePermiso } from '../auth/requiere-permiso.decorator';
import {
  CrearMotivoVisitaDto,
  EditarMotivoVisitaDto,
} from './dto/motivo-visita.dto';
import type { MotivoVisita } from './motivos-visita.repository';
import { MotivosVisitaService } from './motivos-visita.service';

// T-39 (D5). Leer pide solo sesion del portal; escribir, `motivo_visita.gestionar`.
// La tablet no usa estos endpoints: el catalogo le baja en el pull.
@Controller('motivos-visita')
export class MotivosVisitaController {
  constructor(private readonly motivos: MotivosVisitaService) {}

  @Get()
  listar(): Promise<MotivoVisita[]> {
    return this.motivos.listar();
  }

  @Post()
  @RequierePermiso('motivo_visita.gestionar')
  crear(@Body() dto: CrearMotivoVisitaDto): Promise<MotivoVisita> {
    return this.motivos.crear(dto);
  }

  @Patch(':id')
  @RequierePermiso('motivo_visita.gestionar')
  editar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EditarMotivoVisitaDto,
  ): Promise<MotivoVisita> {
    return this.motivos.editar(id, dto);
  }

  @Delete(':id')
  @RequierePermiso('motivo_visita.gestionar')
  async eliminar(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ id: string }> {
    await this.motivos.darDeBaja(id);
    return { id };
  }
}
