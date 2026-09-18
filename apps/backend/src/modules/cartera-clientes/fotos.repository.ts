import { Inject, Injectable } from '@nestjs/common';
import { DB_CONNECTION, type Database } from '../../database/database.tokens';

/** Lo que Postgres guarda de la foto: su nombre de archivo y cuando llego. */
export interface FotoDeCliente {
  /** Nombre dentro de `FOTOS_DIR` (`<clave>.jpg`), nunca una ruta absoluta. */
  archivo: string;
  /** Cuando la recibio el SERVIDOR, no cuando el vendedor la tomo. */
  subidaEn: Date;
}

/**
 * Las dos columnas de foto de `cliente` (T-40).
 *
 * Repositorio propio y no dos metodos en `ClientesRepository` a proposito: ese
 * archivo lo construyeron T-12 y T-40 y lo siguen tocando los tickets del
 * portal. La foto entra por un canal aparte (`POST /sync/foto/:clave`) y no
 * comparte ni una consulta con el alta ni con la edicion, asi que no gana nada
 * viviendo ahi y en cambio suma conflictos de rebase.
 */
@Injectable()
export class FotosRepository {
  constructor(@Inject(DB_CONNECTION) private readonly db: Database) {}

  /**
   * ¿Sigue existiendo esa fila de `cliente`?
   *
   * Se consulta ANTES de escribir el archivo para no dejar basura en el disco
   * por un prospecto que ya no esta. Se ignora `deleted_at` a proposito: una
   * foto que llega para un prospecto dado de baja se guarda igual, porque la
   * baja es blanda y el historial se conserva — descartarla seria perder el
   * unico registro visual de ese lugar por una decision que se puede revertir.
   */
  async existe(clienteId: string): Promise<boolean> {
    const fila = await this.db
      .selectFrom('cliente')
      .select('id')
      .where('id', '=', clienteId)
      .executeTakeFirst();
    return fila !== undefined;
  }

  /**
   * Anota la foto en la fila del cliente. Devuelve `false` si la fila ya no
   * estaba (la borraron entre la comprobacion y esto).
   *
   * > [!info] Esto bumpea `updated_at` por el trigger `trg_cliente_updated`
   * > Consecuencia conocida y aceptada: el cliente vuelve a bajar en el
   * > siguiente `pull` de las tablets de su sucursal y `preciosCambiaron`
   * > devuelve `true` una vez. Es un snapshot de mas al ano por prospecto — el
   * > pull aplica upsert, asi que no cambia nada — y evitarlo exigiria saltarse
   * > el trigger, que es peor.
   */
  async anotar(
    clienteId: string,
    archivo: string,
    subidaEn: Date,
  ): Promise<boolean> {
    const fila = await this.db
      .updateTable('cliente')
      .set({ foto_archivo: archivo, foto_subida_en: subidaEn })
      .where('id', '=', clienteId)
      .returning('id')
      .executeTakeFirst();
    return fila !== undefined;
  }

  /** La foto de ese cliente, o `null` si no tiene. */
  async foto(clienteId: string): Promise<FotoDeCliente | null> {
    const fila = await this.db
      .selectFrom('cliente')
      .select(['foto_archivo', 'foto_subida_en'])
      .where('id', '=', clienteId)
      .executeTakeFirst();

    // Las dos columnas se escriben juntas y siempre, asi que en la practica van
    // de la mano; se exige `foto_archivo` porque es la unica que la lectura
    // necesita y la que decide si hay archivo que servir.
    if (!fila?.foto_archivo) return null;
    return {
      archivo: fila.foto_archivo,
      subidaEn: fila.foto_subida_en ?? new Date(0),
    };
  }
}
