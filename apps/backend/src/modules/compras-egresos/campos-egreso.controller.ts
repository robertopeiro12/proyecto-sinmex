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
import type { CampoEgreso } from './campos-egreso.repository';
import { CamposEgresoService } from './campos-egreso.service';
import {
  CrearCampoEgresoDto,
  EditarCampoEgresoDto,
} from './dto/campo-egreso.dto';

// T-30 (D3). Leer pide solo sesion del portal; escribir, `campo_egreso.gestionar`.
// La tablet no usa estos endpoints: el catalogo le baja en el pull.
@Controller('campos-egreso')
export class CamposEgresoController {
  constructor(private readonly campos: CamposEgresoService) {}

  @Get()
  listar(): Promise<CampoEgreso[]> {
    return this.campos.listar();
  }

  @Post()
  @RequierePermiso('campo_egreso.gestionar')
  crear(@Body() dto: CrearCampoEgresoDto): Promise<CampoEgreso> {
    return this.campos.crear(dto);
  }

  @Patch(':id')
  @RequierePermiso('campo_egreso.gestionar')
  editar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EditarCampoEgresoDto,
  ): Promise<CampoEgreso> {
    return this.campos.editar(id, dto);
  }

  @Delete(':id')
  @RequierePermiso('campo_egreso.gestionar')
  async eliminar(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ id: string }> {
    await this.campos.darDeBaja(id);
    return { id };
  }
}
