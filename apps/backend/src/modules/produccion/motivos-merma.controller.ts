import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { RequierePermiso } from '../auth/requiere-permiso.decorator';
import {
  CrearMotivoMermaDto,
  EditarMotivoMermaDto,
} from './dto/motivo-merma.dto';
import type { MotivoMerma } from './motivos-merma.repository';
import { MotivosMermaService } from './motivos-merma.service';

// Registro de Operacion (D7). Leer pide solo sesion del portal; escribir,
// `motivo_merma.gestionar`.
@Controller('motivos-merma')
export class MotivosMermaController {
  constructor(private readonly motivos: MotivosMermaService) {}

  @Get()
  listar(@Query('aplica') aplica?: string): Promise<MotivoMerma[]> {
    return this.motivos.listar(aplica);
  }

  @Post()
  @RequierePermiso('motivo_merma.gestionar')
  crear(@Body() dto: CrearMotivoMermaDto): Promise<MotivoMerma> {
    return this.motivos.crear(dto);
  }

  @Patch(':id')
  @RequierePermiso('motivo_merma.gestionar')
  editar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EditarMotivoMermaDto,
  ): Promise<MotivoMerma> {
    return this.motivos.editar(id, dto);
  }

  @Delete(':id')
  @RequierePermiso('motivo_merma.gestionar')
  async eliminar(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ id: string }> {
    await this.motivos.darDeBaja(id);
    return { id };
  }
}
