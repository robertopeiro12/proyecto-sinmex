import {
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { TAMANO_MAX_FOTO_BYTES } from '../cartera-clientes/foto-prospecto';
import { SoloApp } from '../auth/solo-app.decorator';
import { VendedorActual } from '../auth/vendedor-actual.decorator';
import { leerCuerpoLimitado } from './cuerpo-crudo';
import { FotoService, type RespuestaFoto } from './foto.service';

/**
 * La foto del prospecto que sube la tablet (T-40).
 *
 * Controller aparte de `SincronizacionController` porque es un canal aparte: no
 * lleva la version del contrato, no responde con `resultados[]` y no comparte ni
 * una linea con el lote del `push`. Tenerlo en su propio archivo tambien deja
 * claro de un vistazo que un cambio aqui **no** puede romper el `push`.
 *
 * Sigue bajo `@Controller('sync')`: es un endpoint de la app, con la misma auth
 * de vendedor, y Nest admite dos controllers con el mismo prefijo.
 */
@Controller('sync')
export class FotoController {
  constructor(private readonly foto: FotoService) {}

  /**
   * `POST /sync/foto/:clave` — el segundo de los "dos requests, un boton".
   *
   * La `clave` es **la misma llave de idempotencia** de la operacion del
   * prospecto, y de ahi sale el nombre del archivo (`<clave>.jpg`). Por eso
   * reenviar es gratis: escribe el mismo nombre y deja un solo archivo. No hay
   * contador, ni identificador nuevo, ni tabla de control que mantener.
   *
   * `ParseUUIDPipe` no es cosmetico: la clave acaba siendo un **nombre de
   * archivo**, y `clave_idempotencia` es texto libre que escribe la tablet. Es la
   * primera barrera contra un `../..` en la URL (la segunda esta en
   * `nombreArchivoFoto`).
   *
   * Responde **200 y no 201**, tambien en la primera subida. La operacion es
   * idempotente —el mismo `PUT` de toda la vida, con la forma de un `POST`
   * porque la ruta la fija la clave, no el servidor— y distinguir 201 de 200
   * obligaria a la tablet a mirar el codigo para nada: lo que hace con los dos
   * es exactamente lo mismo.
   *
   * El cuerpo es el JPEG **crudo**, sin sobre JSON ni multipart: no hay ningun
   * otro campo que mandar, y base64 costaria un 33% mas de bytes en el WiFi del
   * negocio.
   */
  @SoloApp()
  @Post('foto/:clave')
  @HttpCode(HttpStatus.OK)
  async subir(
    @VendedorActual() vendedorId: string,
    @Param('clave', ParseUUIDPipe) clave: string,
    @Req() req: Request,
  ): Promise<RespuestaFoto> {
    // El cuerpo se lee aqui y no con `@Body()`: el unico parser registrado es
    // `express.json` (ver `configurar-app.ts`), asi que un `image/jpeg` llega
    // intacto al handler. Es lo que se queria — el tope de 2 MB lo decide Nest.
    const cuerpo = await leerCuerpoLimitado(
      req,
      TAMANO_MAX_FOTO_BYTES,
      req.headers['content-length'],
    );

    // En minusculas antes de usarla: `clave_idempotencia` es `text` y Postgres
    // compara texto distinguiendo mayusculas. La tablet genera el uuid en
    // minusculas, pero una URL en mayusculas daria un 404 desconcertante — y el
    // nombre del archivo tiene que salir del MISMO valor con el que se busco.
    return this.foto.subir(vendedorId, clave.toLowerCase(), cuerpo);
  }
}
