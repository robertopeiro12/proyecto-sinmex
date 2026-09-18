import { randomUUID } from 'node:crypto';
import { constants as FS, promises as fs } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientesService } from './clientes.service';
import {
  TAMANO_MAX_FOTO_BYTES,
  esJpeg,
  nombreArchivoFoto,
} from './foto-prospecto';
import { FotosRepository } from './fotos.repository';

/** Default de desarrollo, relativo al cwd (`apps/backend` con los scripts del workspace). */
const FOTOS_DIR_POR_DEFECTO = 'var/fotos';

/** La foto ya guardada: su nombre y cuando la recibio el servidor. */
export interface FotoGuardada {
  archivo: string;
  subidaEn: Date;
}

/**
 * El archivo de la foto del prospecto: escribirlo y servirlo (T-40).
 *
 * Vive en `cartera-clientes/` porque Cartera de Clientes es la duena de
 * `cliente` (ADR-0009), y la foto es una propiedad del cliente. `sincronizacion/`
 * pone el endpoint de subida —la clave de la URL es del buzon del push— y
 * despacha aqui, nunca al reves.
 *
 * > [!danger] El archivo primero, la columna despues. No es arbitrario.
 * > Si fallara el paso 2 con el orden invertido, `foto_archivo` apuntaria a un
 * > archivo que no existe: el portal intentaria servirlo y la tablet creeria
 * > que ya subio, asi que la foto se perderia **en silencio y para siempre**.
 * > Con este orden, lo peor que queda es un archivo huerfano en el disco — que
 * > el reintento de la tablet **sobreescribe**, porque el nombre sale de la
 * > clave. Basura recuperable en vez de un dato perdido.
 * >
 * > Y por eso mismo un fallo del paso 2 **sale como error**: no se atrapa para
 * > devolver 200. Si se devolviera exito, la tablet marcaria la foto como
 * > subida y nadie volveria a intentarlo.
 */
@Injectable()
export class FotosService implements OnModuleInit {
  private readonly logger = new Logger(FotosService.name);

  /**
   * `FOTOS_DIR` ya resuelto a ruta absoluta.
   *
   * Absoluta y no tal cual viene: se compara y se sirve, y una ruta relativa
   * cambia de significado con el cwd del proceso. En produccion apunta al
   * **volumen persistente** (ver `Despliegue y topologia`).
   */
  private readonly directorio: string;

  constructor(
    config: ConfigService,
    private readonly repo: FotosRepository,
    // Reusa la doctrina de alcance por sucursal de T-09/T-11 que `obtener` ya
    // aplica, en vez de escribir una segunda copia que un dia discrepe.
    private readonly clientes: ClientesService,
  ) {
    this.directorio = resolve(
      config.get<string>('FOTOS_DIR') ?? FOTOS_DIR_POR_DEFECTO,
    );
  }

  /**
   * Crea el directorio al arrancar, no en la primera subida.
   *
   * Es donde interesa descubrir un volumen mal montado o sin permisos: al
   * arrancar sale en el log del despliegue, y en la primera subida saldria como
   * un 500 a una tablet en el WiFi de un negocio.
   */
  async onModuleInit(): Promise<void> {
    await fs.mkdir(this.directorio, { recursive: true });
    this.logger.log(`Fotos de prospectos en ${this.directorio}`);
  }

  /**
   * Guarda la foto de un prospecto ya proyectado.
   *
   * Valida ANTES de tocar nada: un cuerpo que no es JPEG o que pasa de 2 MB no
   * deja ni archivo ni columna. Es lo que hace que **una foto que falla no se
   * lleve el prospecto** — el fallo que este diseno existe para prevenir.
   */
  async guardar(
    clienteId: string,
    clave: string,
    cuerpo: Buffer,
  ): Promise<FotoGuardada> {
    if (cuerpo.length > TAMANO_MAX_FOTO_BYTES) {
      throw new PayloadTooLargeException(
        `La foto pesa ${cuerpo.length} bytes y el maximo es ${TAMANO_MAX_FOTO_BYTES}. Comprimela mas en el equipo antes de subirla.`,
      );
    }
    if (!esJpeg(cuerpo)) {
      throw new UnsupportedMediaTypeException(
        'El contenido no es un JPEG completo. Vuelve a tomar la foto: la anterior llego corrupta o a medias.',
      );
    }

    // Antes de escribir: que el prospecto siga ahi. Un archivo para una fila que
    // no existe es basura que nadie va a buscar nunca.
    if (!(await this.repo.existe(clienteId))) {
      throw new NotFoundException('Ese prospecto ya no existe.');
    }

    const archivo = nombreArchivoFoto(clave);
    await this.escribirAtomico(archivo, cuerpo);

    const subidaEn = new Date();
    if (!(await this.repo.anotar(clienteId, archivo, subidaEn))) {
      // Carrera: lo borraron entre la comprobacion y el update. El archivo queda
      // huerfano, que es el lado bueno del trato (ver el aviso de la clase).
      throw new NotFoundException('Ese prospecto ya no existe.');
    }

    return { archivo, subidaEn };
  }

  /**
   * La ruta del archivo a servir en el portal, con el alcance ya comprobado.
   *
   * `ClientesService.obtener` es quien decide el 404 (no existe) y el 403 (no es
   * de tu sucursal): la regla vive una sola vez.
   */
  async rutaParaPortal(usuarioId: string, clienteId: string): Promise<string> {
    await this.clientes.obtener(usuarioId, clienteId);

    const foto = await this.repo.foto(clienteId);
    if (!foto) {
      throw new NotFoundException('Ese cliente no tiene foto.');
    }

    const ruta = join(this.directorio, foto.archivo);
    try {
      await fs.access(ruta, FS.R_OK);
    } catch {
      // La columna dice que hay foto y el archivo no esta: el volumen se
      // reemplazo o se perdio. Un 404 es la verdad para quien pregunta, pero en
      // el log va como aviso porque significa que el disco y la base no
      // coinciden — exactamente lo que el respaldo pendiente del volumen
      // (`Despliegue y topologia`) predice.
      this.logger.warn(
        `cliente ${clienteId}: foto_archivo apunta a ${ruta}, que no esta en el disco`,
      );
      throw new NotFoundException('Ese cliente no tiene foto.');
    }
    return ruta;
  }

  /**
   * Escribe a un temporal unico y renombra.
   *
   * `rename` dentro del mismo sistema de archivos es atomico, asi que el portal
   * nunca ve un `<clave>.jpg` a medio escribir; y el temporal lleva un sufijo
   * unico para que dos subidas simultaneas de la misma clave no se entrelacen
   * los bytes. La ultima gana, y queda **un solo archivo** — la idempotencia
   * sigue siendo "asi se llama", no codigo que la vigile.
   */
  private async escribirAtomico(
    archivo: string,
    cuerpo: Buffer,
  ): Promise<void> {
    // Idempotente: el directorio puede haber desaparecido con un remontaje del
    // volumen desde que arranco el proceso.
    await fs.mkdir(this.directorio, { recursive: true });

    const destino = join(this.directorio, archivo);
    const temporal = `${destino}.${randomUUID()}.parcial`;
    try {
      await fs.writeFile(temporal, cuerpo);
      await fs.rename(temporal, destino);
    } catch (error) {
      await fs.unlink(temporal).catch(() => undefined);
      throw error;
    }
  }
}
