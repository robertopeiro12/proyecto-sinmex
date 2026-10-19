import { createReadStream } from 'node:fs';
import {
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Query,
  StreamableFile,
} from '@nestjs/common';
import { RequierePermiso } from '../auth/requiere-permiso.decorator';
import { UsuarioActual } from '../auth/usuario-actual.decorator';
import { ListarGastosDto } from './dto/listar-gastos.dto';
import { GastosService, type ListaGastos } from './gastos.service';

// T-30/T-31 (D10). Finanzas › Gastos del portal: solo consulta. Capturar,
// editar y borrar compras de oficina es el siguiente ticket (el resto de T-31).
@Controller('gastos')
export class GastosController {
  constructor(private readonly gastos: GastosService) {}

  @Get()
  @RequierePermiso('gasto.ver')
  listar(
    @UsuarioActual() usuarioId: string,
    @Query() q: ListarGastosDto,
  ): Promise<ListaGastos> {
    return this.gastos.listar(usuarioId, q);
  }

  /**
   * La foto del ticket (opcional). Mismo patron que `GET /clientes/:id/foto`:
   * archivo privado, cache corto y no compartido; `rutaFoto` ya comprobo que el
   * archivo se puede leer, asi que el stream no falla a media respuesta.
   */
  @Get(':id/foto')
  @RequierePermiso('gasto.ver')
  @Header('Cache-Control', 'private, max-age=300')
  async foto(
    @UsuarioActual() usuarioId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<StreamableFile> {
    const ruta = await this.gastos.rutaFoto(usuarioId, id.toLowerCase());
    return new StreamableFile(createReadStream(ruta), { type: 'image/jpeg' });
  }
}
