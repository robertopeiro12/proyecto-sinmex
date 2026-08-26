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
} from '@nestjs/common';
import { RequierePermiso } from './requiere-permiso.decorator';
import { PerfilesService, type MatrizPerfiles } from './perfiles.service';
import { CrearPerfilDto } from './dto/crear-perfil.dto';
import { EditarPerfilDto } from './dto/editar-perfil.dto';
import { ActualizarPermisoPerfilDto } from './dto/actualizar-permiso-perfil.dto';
import type { PerfilResumen } from './perfiles.repository';

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

  @Post()
  @HttpCode(201)
  async crear(@Body() dto: CrearPerfilDto): Promise<PerfilResumen> {
    return this.perfiles.crear(dto.nombre);
  }

  @Patch(':id')
  async renombrar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EditarPerfilDto,
  ): Promise<PerfilResumen> {
    return this.perfiles.renombrar(id, dto.nombre);
  }

  @Delete(':id')
  async darDeBaja(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ id: string }> {
    await this.perfiles.darDeBaja(id);
    return { id };
  }

  @Patch(':id/permisos')
  async togglePermiso(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ActualizarPermisoPerfilDto,
  ): Promise<{ perfilId: string; permisoId: string; habilitado: boolean }> {
    await this.perfiles.togglePermiso(id, dto.permisoId, dto.habilitado);
    return {
      perfilId: id,
      permisoId: dto.permisoId,
      habilitado: dto.habilitado,
    };
  }
}
