import { Inject, Injectable } from '@nestjs/common';
import { DB_CONNECTION, type Database } from '../../database/database.tokens';

export interface Sesion {
  id: string;
  usuario_id: string;
  expira_en: Date;
  revocada_en: Date | null;
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

  async buscarPorHash(tokenHash: string): Promise<Sesion | undefined> {
    return this.db
      .selectFrom('sesion_refresh')
      .select(['id', 'usuario_id', 'expira_en', 'revocada_en'])
      .where('token_hash', '=', tokenHash)
      .executeTakeFirst();
  }

  async revocar(
    id: string,
    reemplazadaPor: string | null = null,
  ): Promise<void> {
    await this.db
      .updateTable('sesion_refresh')
      .set({ revocada_en: new Date(), reemplazada_por: reemplazadaPor })
      .where('id', '=', id)
      .execute();
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
