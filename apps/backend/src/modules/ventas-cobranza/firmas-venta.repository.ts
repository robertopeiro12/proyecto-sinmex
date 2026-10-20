import { Inject, Injectable } from '@nestjs/common';
import { DB_CONNECTION, type Database } from '../../database/database.tokens';

/** Lo que dice una nota de su firma, para el canal de fotos (T-73). */
export type EstadoFirmaVenta = 'inexistente' | 'no-espera' | 'espera';

/**
 * Las columnas de firma de `venta_nota` fuera de la transaccion del push
 * (T-73). `VentasRepository` no inyecta la conexion a proposito (todo lo suyo
 * corre en la `trx` de quien llama); el canal de fotos y el portal leen y
 * escriben sueltos, como `GastosRepository.existe/anotarFoto`.
 */
@Injectable()
export class FirmasVentaRepository {
  constructor(@Inject(DB_CONNECTION) private readonly db: Database) {}

  /**
   * Inexistente (o eliminada), viva sin firma esperada, o viva esperandola. Tres
   * respuestas y no un booleano: el canal contesta 404 a la primera y 409 a la
   * segunda.
   */
  async estadoFirma(id: string): Promise<EstadoFirmaVenta> {
    const fila = await this.db
      .selectFrom('venta_nota')
      .select('firma_esperada')
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!fila) return 'inexistente';
    return fila.firma_esperada ? 'espera' : 'no-espera';
  }

  /**
   * Anota la imagen. `false` si la nota se elimino (o dejo de esperar firma)
   * entre la comprobacion y la escritura del archivo.
   *
   * El trigger de `updated_at` la mueve: una nota a credito vuelve a bajar en el
   * pull incremental, lo que es inofensivo (la tablet hace upsert por id).
   */
  async anotarFirma(
    id: string,
    archivo: string,
    subidaEn: Date,
  ): Promise<boolean> {
    const fila = await this.db
      .updateTable('venta_nota')
      .set({ firma_archivo: archivo, firma_subida_en: subidaEn })
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .where('firma_esperada', '=', true)
      .returning('id')
      .executeTakeFirst();
    return fila !== undefined;
  }

  /** El archivo de la firma de una nota viva, o `null` si no ha llegado o no hay. */
  async archivoFirma(id: string): Promise<string | null> {
    const fila = await this.db
      .selectFrom('venta_nota')
      .select('firma_archivo')
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .where('firma_archivo', 'is not', null)
      .executeTakeFirst();
    return fila?.firma_archivo ?? null;
  }
}
