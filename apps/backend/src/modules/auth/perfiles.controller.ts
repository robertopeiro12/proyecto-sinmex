import { Controller, Get } from '@nestjs/common';
import { RequierePermiso } from './requiere-permiso.decorator';
import { PerfilesService, type MatrizPerfiles } from './perfiles.service';

// Sin @Publico(): el guard global de app.module.ts protege todo por defecto.
// A diferencia de sucursales/productos/vehiculos/precios, el decorador va a
// nivel de CLASE: los cinco endpoints de este controlador exigen
// perfil.gestionar sin excepcion (D3 del spec) -- la matriz completa es
// informacion de seguridad, no un catalogo operativo que otra pantalla
// necesite consultar sin el permiso. PermisosGuard lee metadata de clase Y de
// metodo (permisos.guard.ts:33-36), asi que esto ya funciona con el guard tal
// cual quedo en T-08a, sin tocarlo.
@Controller('perfiles')
@RequierePermiso('perfil.gestionar')
export class PerfilesController {
  constructor(private readonly perfiles: PerfilesService) {}

  @Get()
  async obtener(): Promise<MatrizPerfiles> {
    return this.perfiles.obtenerMatriz();
  }
}
