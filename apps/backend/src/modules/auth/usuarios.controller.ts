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
import { UsuarioActual } from './usuario-actual.decorator';
import { RequierePermiso } from './requiere-permiso.decorator';
import { normalizarSucursalPedida } from '../sucursales/alcance-sucursal';
import { CrearUsuarioDto } from './dto/crear-usuario.dto';
import { UsuariosService } from './usuarios.service';
import type { MatrizPerfiles } from './perfiles.service';
import type { UsuarioDetalle, UsuarioResumen } from './usuarios.repository';

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

  @Get()
  async listar(
    @UsuarioActual() usuarioId: string,
    @Query('sucursal') sucursal?: string,
  ): Promise<UsuarioResumen[]> {
    return this.usuarios.listar(usuarioId, normalizarSucursalPedida(sucursal));
  }

  @Get(':id')
  async obtener(
    @UsuarioActual() usuarioId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<UsuarioDetalle> {
    return this.usuarios.obtener(usuarioId, id);
  }

  @Post()
  @HttpCode(201)
  async crear(
    @UsuarioActual() usuarioId: string,
    @Body() dto: CrearUsuarioDto,
  ): Promise<UsuarioDetalle> {
    return this.usuarios.crear(usuarioId, dto);
  }
}
