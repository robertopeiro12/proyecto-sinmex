import { Inject, Injectable } from '@nestjs/common';
import { DB_CONNECTION, type Database } from '../../database/database.tokens';

export interface SesionVendedor {
  id: string;
  vendedor_id: string;
  expira_en: Date;
  revocada_en: Date | null;
  /**
   * Estado del DUENO de la sesion, no de la sesion.
   *
   * Aqui hay **dos** interruptores y no uno solo (el portal tiene solo
   * `deleted_at`): un vendedor se puede dar de baja (`deleted_at`) o
   * simplemente desactivar (`activo = false`, la baja logica que describe
   * [[Vendedor]] en el vault, pensada para gente rotativa que conserva su
   * historico). Los dos tienen que cortar la sesion; comprobar solo uno deja
   * la mitad de las bajas sin efecto.
   *
   * Viajan con la fila por lo mismo que en el portal: quien rota un refresh
   * necesita decidir con el estado del vendedor, y traerlo en el mismo SELECT
   * evita una segunda consulta y, sobre todo, que alguien olvide hacerla.
   */
  vendedor_deleted_at: Date | null;
  vendedor_activo: boolean;
}

@Injectable()
export class SesionVendedorRepository {
  constructor(@Inject(DB_CONNECTION) private readonly db: Database) {}

  async crear(
    vendedorId: string,
    tokenHash: string,
    expiraEn: Date,
  ): Promise<string> {
    const fila = await this.db
      .insertInto('sesion_vendedor')
      .values({
        vendedor_id: vendedorId,
        token_hash: tokenHash,
        expira_en: expiraEn,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return fila.id;
  }

  /** innerJoin y no leftJoin, por el mismo motivo que en `sesion.repository.ts`. */
  async buscarPorHash(tokenHash: string): Promise<SesionVendedor | undefined> {
    return this.db
      .selectFrom('sesion_vendedor')
      .innerJoin('vendedor', 'vendedor.id', 'sesion_vendedor.vendedor_id')
      .select([
        'sesion_vendedor.id as id',
        'sesion_vendedor.vendedor_id as vendedor_id',
        'sesion_vendedor.expira_en as expira_en',
        'sesion_vendedor.revocada_en as revocada_en',
        'vendedor.deleted_at as vendedor_deleted_at',
        'vendedor.activo as vendedor_activo',
      ])
      .where('sesion_vendedor.token_hash', '=', tokenHash)
      .executeTakeFirst();
  }

  async revocar(
    id: string,
    reemplazadaPor: string | null = null,
  ): Promise<void> {
    await this.db
      .updateTable('sesion_vendedor')
      .set({
        revocada_en: new Date(),
        ...(reemplazadaPor !== null ? { reemplazada_por: reemplazadaPor } : {}),
      })
      .where('id', '=', id)
      .execute();
  }

  /**
   * Punto de serializacion de la rotacion: solo una de dos rotaciones
   * concurrentes consigue marcar la fila revocada. Ver el comentario extenso
   * en `TokenService.rotarRefresh`, que explica por que esto es lo unico que
   * hace visible el reuso de un token bajo concurrencia.
   */
  async revocarSiViva(
    id: string,
    reemplazadaPor: string | null = null,
  ): Promise<boolean> {
    const resultado = await this.db
      .updateTable('sesion_vendedor')
      .set({
        revocada_en: new Date(),
        ...(reemplazadaPor !== null ? { reemplazada_por: reemplazadaPor } : {}),
      })
      .where('id', '=', id)
      .where('revocada_en', 'is', null)
      .executeTakeFirst();
    return resultado.numUpdatedRows === 1n;
  }

  /** Corta todas las sesiones vivas del vendedor (reuso detectado). */
  async revocarTodasDelVendedor(vendedorId: string): Promise<void> {
    await this.db
      .updateTable('sesion_vendedor')
      .set({ revocada_en: new Date() })
      .where('vendedor_id', '=', vendedorId)
      .where('revocada_en', 'is', null)
      .execute();
  }
}
