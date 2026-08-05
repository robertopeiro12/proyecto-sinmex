import { Inject, Injectable } from '@nestjs/common';
import { DB_CONNECTION, type Database } from '../../database/database.tokens';

export interface Sesion {
  id: string;
  usuario_id: string;
  expira_en: Date;
  revocada_en: Date | null;
  /**
   * Baja logica del DUENO de la sesion, no de la sesion. Viaja con la fila
   * porque quien rota un refresh necesita decidir con el estado del usuario y
   * no hay forma de saberlo sin volver a la base; traerlo en el mismo SELECT
   * evita esa segunda consulta y, sobre todo, evita que alguien olvide
   * hacerla.
   */
  usuario_deleted_at: Date | null;
}

@Injectable()
export class SesionRepository {
  constructor(@Inject(DB_CONNECTION) private readonly db: Database) {}

  async crear(
    usuarioId: string,
    tokenHash: string,
    expiraEn: Date,
  ): Promise<string> {
    const fila = await this.db
      .insertInto('sesion_refresh')
      .values({
        usuario_id: usuarioId,
        token_hash: tokenHash,
        expira_en: expiraEn,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return fila.id;
  }

  /**
   * Trae la sesion junto con la baja logica de su dueno (innerJoin con
   * usuario). El join es innerJoin y no leftJoin a proposito: usuario_id
   * tiene FK a usuario, asi que una sesion sin usuario no puede existir; si
   * alguna vez existiera, no queremos que la sesion se cuele con
   * usuario_deleted_at = null, queremos que no aparezca.
   */
  async buscarPorHash(tokenHash: string): Promise<Sesion | undefined> {
    return this.db
      .selectFrom('sesion_refresh')
      .innerJoin('usuario', 'usuario.id', 'sesion_refresh.usuario_id')
      .select([
        'sesion_refresh.id as id',
        'sesion_refresh.usuario_id as usuario_id',
        'sesion_refresh.expira_en as expira_en',
        'sesion_refresh.revocada_en as revocada_en',
        'usuario.deleted_at as usuario_deleted_at',
      ])
      .where('sesion_refresh.token_hash', '=', tokenHash)
      .executeTakeFirst();
  }

  async revocar(
    id: string,
    reemplazadaPor: string | null = null,
  ): Promise<void> {
    await this.db
      .updateTable('sesion_refresh')
      // Solo se escribe reemplazada_por cuando se pasa explicitamente: si se
      // omite (logout, limpieza de una sesion perdedora de carrera), no hay
      // que pisar un encadenamiento que ya pudiera existir en la fila.
      .set({
        revocada_en: new Date(),
        ...(reemplazadaPor !== null ? { reemplazada_por: reemplazadaPor } : {}),
      })
      .where('id', '=', id)
      .execute();
  }

  /**
   * Revoca solo si la sesion sigue viva (WHERE revocada_en IS NULL) y reporta
   * si esta llamada fue la que gano. Es el punto de serializacion de la
   * rotacion: bajo dos rotaciones concurrentes del mismo token, Postgres
   * serializa el UPDATE sobre la misma fila y solo una de las dos llamadas
   * consigue marcarla revocada; la otra ve 0 filas afectadas.
   */
  async revocarSiViva(
    id: string,
    reemplazadaPor: string | null = null,
  ): Promise<boolean> {
    const resultado = await this.db
      .updateTable('sesion_refresh')
      .set({
        revocada_en: new Date(),
        ...(reemplazadaPor !== null ? { reemplazada_por: reemplazadaPor } : {}),
      })
      .where('id', '=', id)
      .where('revocada_en', 'is', null)
      .executeTakeFirst();
    return resultado.numUpdatedRows === 1n;
  }

  /** Corta todas las sesiones vivas del usuario (reuso de token detectado, o logout total). */
  async revocarTodasDelUsuario(usuarioId: string): Promise<void> {
    await this.db
      .updateTable('sesion_refresh')
      .set({ revocada_en: new Date() })
      .where('usuario_id', '=', usuarioId)
      .where('revocada_en', 'is', null)
      .execute();
  }
}
