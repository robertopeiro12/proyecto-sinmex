import { Controller, Get } from '@nestjs/common';
import { RequierePermiso } from './requiere-permiso.decorator';
import { UsuariosService } from './usuarios.service';
import type { MatrizPerfiles } from './perfiles.service';

// Sin @Publico(): el guard global protege todo por defecto. Igual que
// PerfilesController (T-08b): el decorador va a nivel de CLASE -- los seis
// endpoints de este controlador exigen usuario.gestionar sin excepcion,
// lectura incluida (D6 del spec).
//
// GET 'catalogo-perfiles' se declara ANTES que GET ':id' (Task 4): Nest
// resuelve rutas en orden de declaracion dentro del controlador, y si
// ':id' fuera primero, "catalogo-perfiles" caeria ahi como si fuera un uuid
// y ParseUUIDPipe lo rechazaria con 400 en vez de llegar a este metodo.
@Controller('usuarios')
@RequierePermiso('usuario.gestionar')
export class UsuariosController {
  constructor(private readonly usuarios: UsuariosService) {}

  @Get('catalogo-perfiles')
  async catalogoPerfiles(): Promise<MatrizPerfiles> {
    return this.usuarios.catalogoPerfiles();
  }
}
