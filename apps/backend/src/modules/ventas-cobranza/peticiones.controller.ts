import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { RequierePermiso } from '../auth/requiere-permiso.decorator';
import { UsuarioActual } from '../auth/usuario-actual.decorator';
import type { VistaBorrado } from './cobros-borrado.service';
import {
  BandejaDto,
  DenegarPeticionDto,
  SolicitarEliminarCobroDto,
} from './dto/peticiones.dto';
import type { PeticionEnBandeja } from './peticiones.repository';
import { PeticionesService } from './peticiones.service';

// T-34. La bandeja, la vista previa de una peticion y resolverla piden
// `peticiones.gestionar`; PEDIR el borrado pide `cobranza.editar_eliminar`.
// Si alguien tiene los dos, puede pedir y autorizar (decision de Roberto).
@Controller('peticiones')
export class PeticionesController {
  constructor(private readonly peticiones: PeticionesService) {}

  @Get()
  @RequierePermiso('peticiones.gestionar')
  bandeja(
    @UsuarioActual() usuarioId: string,
    @Query() q: BandejaDto,
  ): Promise<PeticionEnBandeja[]> {
    return this.peticiones.bandeja(usuarioId, q);
  }

  @Get(':id/vista-previa')
  @RequierePermiso('peticiones.gestionar')
  vistaPrevia(
    @UsuarioActual() usuarioId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<VistaBorrado> {
    return this.peticiones.vistaDePeticion(usuarioId, id);
  }

  @Post('eliminar-cobro')
  @RequierePermiso('cobranza.editar_eliminar')
  solicitar(
    @UsuarioActual() usuarioId: string,
    @Body() dto: SolicitarEliminarCobroDto,
  ): Promise<PeticionEnBandeja> {
    return this.peticiones.solicitarEliminarCobro(usuarioId, dto);
  }

  @Post(':id/autorizar')
  @HttpCode(200)
  @RequierePermiso('peticiones.gestionar')
  autorizar(
    @UsuarioActual() usuarioId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PeticionEnBandeja> {
    return this.peticiones.autorizar(usuarioId, id);
  }

  @Post(':id/denegar')
  @HttpCode(200)
  @RequierePermiso('peticiones.gestionar')
  denegar(
    @UsuarioActual() usuarioId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DenegarPeticionDto,
  ): Promise<PeticionEnBandeja> {
    return this.peticiones.denegar(usuarioId, id, dto);
  }
}
