import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { FotosService } from '../cartera-clientes/fotos.service';
import { FotoRepository } from './foto.repository';

/** Lo que devuelve la subida. Confirma; no hay nada que la tablet tenga que guardar. */
export interface RespuestaFoto {
  clave: string;
  /** Cuando la recibio el servidor, en ISO. */
  subida_en: string;
}

/**
 * `POST /sync/foto/:clave`: resolver la clave y dejar que Cartera de Clientes
 * guarde el archivo (T-40).
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

    // Una venta (o cualquier otro tipo) no tiene foto. `409` y no `400`: la
    // peticion esta bien formada, lo que no encaja es el estado del servidor.
    if (mia.tipo !== 'prospecto') {
      throw new ConflictException(
        `La operacion ${clave} es de tipo "${mia.tipo}", y solo un prospecto lleva foto.`,
      );
    }

    /**
     * Aceptada pero **sin proyectar**: `409`.
     *
     * `entidad_id` nulo significa que no hay fila `cliente` a la que la foto
     * pertenezca, asi que no hay donde anotarla. Es el mismo 409 que el caso de
     * arriba porque para la tablet la accion es la misma: dejarla pendiente y
     * reintentar en la siguiente sincronizacion.
     */
    if (mia.entidadTabla !== 'cliente' || mia.entidadId === null) {
      throw new ConflictException(
        'Ese prospecto todavia no esta proyectado en la cartera. Reintenta en la siguiente sincronizacion.',
      );
    }

    const guardada = await this.fotos.guardar(mia.entidadId, clave, cuerpo);
    return { clave, subida_en: guardada.subidaEn.toISOString() };
  }
}
