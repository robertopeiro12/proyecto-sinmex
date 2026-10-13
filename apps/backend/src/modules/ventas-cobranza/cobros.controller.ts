import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { RequierePermiso } from '../auth/requiere-permiso.decorator';
import { UsuarioActual } from '../auth/usuario-actual.decorator';
import type { VistaBorrado } from './cobros-borrado.service';
import { PeticionesService } from './peticiones.service';

// T-34: la vista previa de borrar un pago, para quien lo PIDE. Quien autoriza
// usa `GET /peticiones/:id/vista-previa` (otro permiso, mismo calculo).
@Controller('cobros')
export class CobrosController {
  constructor(private readonly peticiones: PeticionesService) {}

  @Get(':id/vista-borrado')
  @RequierePermiso('cobranza.editar_eliminar')
  vistaBorrado(
    @UsuarioActual() usuarioId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<VistaBorrado> {
    return this.peticiones.vistaDeCobro(usuarioId, id);
  }
}
