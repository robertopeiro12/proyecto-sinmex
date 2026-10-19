import { createReadStream } from 'node:fs';
import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  StreamableFile,
} from '@nestjs/common';
import { UsuarioActual } from '../auth/usuario-actual.decorator';
import { RequierePermiso } from '../auth/requiere-permiso.decorator';
import { normalizarSucursalPedida } from '../sucursales/alcance-sucursal';
import { ClientesService, normalizarTipoPedido } from './clientes.service';
import { CrearClienteDto } from './dto/crear-cliente.dto';
import { EditarClienteDto } from './dto/editar-cliente.dto';
import type { ClienteDetalle, ClienteResumen } from './clientes.repository';
import { FotosService } from './fotos.service';
import {
  UbicacionClientesService,
  type UbicacionGeocodificada,
} from './ubicacion-clientes.service';

// Sin @Publico(): el guard global protege todo por defecto. Ni listar ni
// leer el detalle exigen cliente.gestionar (D2 del spec): el candado va
// solo en los endpoints de escritura (crear/editar/eliminar), igual que
// Vehiculos (T-11) y Productos (T-10).
@Controller('clientes')
export class ClientesController {
  constructor(
    private readonly clientes: ClientesService,
    // T-40: la foto del prospecto. Es un archivo del disco del backend, no una
    // columna, asi que tiene su propio servicio.
    private readonly fotos: FotosService,
    // T-72: "Ubicar con la dirección" (espera a Google, como mucho 5 s).
    private readonly ubicacion: UbicacionClientesService,
  ) {}

  @Get()
  async listar(
    @UsuarioActual() usuarioId: string,
    @Query('sucursal') sucursal?: string,
    @Query('tipo') tipo?: string,
  ): Promise<ClienteResumen[]> {
    return this.clientes.listar(
      usuarioId,
      normalizarSucursalPedida(sucursal),
      normalizarTipoPedido(tipo),
    );
  }

  @Get(':id')
  async obtener(
    @UsuarioActual() usuarioId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ClienteDetalle> {
    return this.clientes.obtener(usuarioId, id);
  }

  /**
   * La foto del lugar que tomo el vendedor al registrar el prospecto (T-40).
   *
   * Sin `@RequierePermiso`, igual que `listar` y `obtener`: el candado del
   * catalogo de clientes va solo en la escritura, y esto es la misma lectura del
   * prospecto vista de otra forma. El alcance por sucursal si se comprueba —lo
   * hace `ClientesService.obtener` dentro de `rutaParaPortal`—, asi que un
   * usuario de otra sucursal recibe 403 y no la foto.
   *
   * **404 cuando no hay foto**, que es el caso normal: la foto es opcional y la
   * mayoria de los prospectos no la tendra. El portal no llega a pedirla salvo
   * que `tieneFoto` venga en `true`, asi que este 404 es la red de seguridad
   * (una foto que se borro del disco), no el camino habitual.
   *
   * `:id/foto` no choca con `:id`: Express compara por segmentos, y una ruta de
   * dos segmentos nunca entra en una de uno.
   */
  @Get(':id/foto')
  // El archivo es privado (un negocio de la cartera) y no puede quedar en un
  // cache compartido. `max-age` corto y no `no-store` porque la miniatura y la
  // vista ampliada son la misma URL: sin cache, ampliarla la volveria a bajar.
  @Header('Cache-Control', 'private, max-age=300')
  async foto(
    @UsuarioActual() usuarioId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<StreamableFile> {
    const ruta = await this.fotos.rutaParaPortal(usuarioId, id);
    // `rutaParaPortal` ya comprobo que el archivo esta y se puede leer, asi que
    // el stream no puede fallar a mitad de la respuesta (cuando ya se mandaron
    // las cabeceras y un 404 ya no es posible).
    return new StreamableFile(createReadStream(ruta), { type: 'image/jpeg' });
  }

  @Post()
  @RequierePermiso('cliente.gestionar')
  async crear(
    @UsuarioActual() usuarioId: string,
    @Body() dto: CrearClienteDto,
  ): Promise<ClienteDetalle> {
    return this.clientes.crear(usuarioId, dto);
  }

  @Patch(':id')
  @RequierePermiso('cliente.gestionar')
  async editar(
    @UsuarioActual() usuarioId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EditarClienteDto,
  ): Promise<ClienteDetalle> {
    return this.clientes.editar(usuarioId, id, dto);
  }

  @Delete(':id')
  @RequierePermiso('cliente.gestionar')
  async eliminar(
    @UsuarioActual() usuarioId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ id: string }> {
    await this.clientes.eliminar(usuarioId, id);
    return { id };
  }

  // Un solo sentido (Prospecto -> Cliente): sin cuerpo, la accion es fija.
  @Post(':id/convertir-a-cliente')
  @RequierePermiso('cliente.gestionar')
  async convertirACliente(
    @UsuarioActual() usuarioId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ClienteDetalle> {
    return this.clientes.convertirACliente(usuarioId, id);
  }

  /**
   * "Ubicar con la dirección" (T-72, D5): geocodifica el domicilio guardado y,
   * si Google da una coordenada precisa, la anota con origen `geocodificada`.
   *
   * A diferencia del intento en segundo plano, **espera** (Google tiene 5 s) y
   * responde el resultado: 200 con la coordenada, 409 con el motivo en espanol
   * o 502 si Google no respondio. `cliente.gestionar`, como editar la ficha;
   * otra sucursal es 404. 200 y no 201: no crea nada.
   */
  @Post(':id/ubicar')
  @HttpCode(200)
  @RequierePermiso('cliente.gestionar')
  async ubicar(
    @UsuarioActual() usuarioId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<UbicacionGeocodificada> {
    return this.ubicacion.ubicar(usuarioId, id);
  }
}
