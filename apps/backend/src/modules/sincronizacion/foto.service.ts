import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { nombreArchivoFoto } from '../cartera-clientes/foto-prospecto';
import { FotosService } from '../cartera-clientes/fotos.service';
import { VisitasService } from '../rutas/visitas.service';
import { FotoRepository } from './foto.repository';

/** Lo que devuelve la subida. Confirma; no hay nada que la tablet tenga que guardar. */
export interface RespuestaFoto {
  clave: string;
  /** Cuando la recibio el servidor, en ISO. */
  subida_en: string;
}

/**
 * `POST /sync/foto/:clave`: resolver la clave (prospecto o visita, T-39) y
 * despachar al dueño de la fila (T-40).
 *
 * > [!danger] Esto NO es el contrato del `push`, y es el punto del diseno
 * > La foto viaja en un **request aparte**, no dentro de la operacion del lote.
 * > El contrato de ADR-0006 acepta o rechaza cada operacion **entera**: si la
 * > foto fuera parte del alta, una imagen pesada o una subida a medias
 * > rechazaria el prospecto completo — se perderia un cliente potencial por no
 * > poder subir algo que es **opcional**.
 * >
 * > De ahi que aqui no haya ni `contrato:`, ni codigos de `CODIGOS_RECHAZO`, ni
 * > `resultados[]`: le bastan los codigos HTTP. Un fallo de la foto se anota en
 * > los campos de foto y **el estado del prospecto no se toca**.
 *
 * El orden obligatorio es el otro lado de la misma moneda: la foto solo puede
 * subir **despues** de que el prospecto fue aceptado, porque antes no existe la
 * fila `cliente` a la que pertenece.
 */
@Injectable()
export class FotoService {
  constructor(
    private readonly repo: FotoRepository,
    // ADR-0009: sincronizacion despacha a los modulos de dominio. Cartera de
    // Clientes es la duena de `cliente` y por tanto del archivo y de las dos
    // columnas; aqui solo se resuelve la clave, que es lo unico que es del buzon.
    private readonly fotos: FotosService,
    // T-39: Rutas es la duena de `visita` y de sus dos columnas de foto.
    private readonly visitas: VisitasService,
  ) {}

  async subir(
    vendedorId: string,
    clave: string,
    cuerpo: Buffer,
  ): Promise<RespuestaFoto> {
    const operaciones = await this.repo.porClave(clave);

    /**
     * Nadie tiene esa clave: `404`.
     *
     * Cubre los dos casos que la tablet tiene que distinguir de un fallo de red:
     * una clave que el servidor no conoce (el `push` del prospecto todavia no
     * paso) y una operacion **rechazada**, que por el contrato §7 **no deja
     * fila**. En ambos la foto se queda pendiente y se vuelve a intentar cuando
     * el prospecto entre.
     */
    if (operaciones.length === 0) {
      throw new NotFoundException(
        'No hay ninguna operacion con esa clave. Sincroniza el prospecto antes de subir su foto.',
      );
    }

    /**
     * La clave existe pero es de otro vendedor: `403`.
     *
     * No es un caso de red ni de orden: es un equipo mandando la foto de un
     * prospecto que no capturo. Se distingue del 404 a proposito para que quede
     * en el log como lo que es.
     */
    const mia = operaciones.find((o) => o.vendedorId === vendedorId);
    if (!mia) {
      throw new ForbiddenException(
        'Esa operacion no es tuya: la foto solo la puede subir el vendedor que registro el prospecto.',
      );
    }

    if (mia.tipo === 'prospecto') {
      /**
       * Aceptado pero **sin proyectar**: `409`.
       *
       * `entidad_id` nulo significa que no hay fila `cliente` a la que la foto
       * pertenezca. Para la tablet la accion es dejarla pendiente y reintentar
       * en la siguiente sincronizacion.
       */
      if (mia.entidadTabla !== 'cliente' || mia.entidadId === null) {
        throw new ConflictException(
          'Ese prospecto todavia no esta proyectado en la cartera. Reintenta en la siguiente sincronizacion.',
        );
      }
      const guardada = await this.fotos.guardar(mia.entidadId, cuerpo);
      return { clave, subida_en: guardada.subidaEn.toISOString() };
    }

    if (mia.tipo === 'visita') {
      // Mismo 409 que el prospecto: la tablet la deja pendiente y reintenta.
      if (mia.entidadTabla !== 'visita' || mia.entidadId === null) {
        throw new ConflictException(
          'Esa visita todavia no esta proyectada. Reintenta en la siguiente sincronizacion.',
        );
      }
      const subidaEn = await this.guardarDeVisita(mia.entidadId, cuerpo);
      return { clave, subida_en: subidaEn.toISOString() };
    }

    // Una venta (o cualquier otro tipo) no tiene foto. `409` y no `400`: la
    // peticion esta bien formada, lo que no encaja es el estado del servidor.
    throw new ConflictException(
      `La operacion ${clave} es de tipo "${mia.tipo}", y solo un prospecto o una visita lleva foto.`,
    );
  }

  /**
   * La foto de una visita (T-39): mismas reglas de bytes que la del prospecto
   * (`validarFoto`), el mismo disco (`escribirArchivo`) y el mismo orden — el
   * archivo primero, la columna despues (ver el aviso de `FotosService`).
   */
  private async guardarDeVisita(
    visitaId: string,
    cuerpo: Buffer,
  ): Promise<Date> {
    this.fotos.validarFoto(cuerpo);
    if (!(await this.visitas.existe(visitaId))) {
      throw new NotFoundException('Esa visita ya no existe.');
    }
    const archivo = nombreArchivoFoto('visita', visitaId);
    await this.fotos.escribirArchivo(archivo, cuerpo);
    const subidaEn = new Date();
    if (!(await this.visitas.anotarFoto(visitaId, archivo, subidaEn))) {
      throw new NotFoundException('Esa visita ya no existe.');
    }
    return subidaEn;
  }

  /**
   * `GET /sync/foto/cliente/:clienteId` (T-39, D9): la ruta del JPEG del
   * cliente o prospecto, si es de la sucursal del vendedor del token.
   */
  async rutaDeCliente(vendedorId: string, clienteId: string): Promise<string> {
    const sucursalId = await this.repo.sucursalDeVendedor(vendedorId);
    if (sucursalId === null) {
      throw new NotFoundException('Ese cliente no tiene foto.');
    }
    return this.fotos.rutaParaVendedor(sucursalId, clienteId);
  }
}
