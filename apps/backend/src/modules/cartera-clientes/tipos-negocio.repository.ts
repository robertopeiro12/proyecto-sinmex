import { Inject, Injectable } from '@nestjs/common';
import { DB_CONNECTION, type Database } from '../../database/database.tokens';

export interface TipoNegocio {
  id: string;
  nombre: string;
}

@Injectable()
export class TiposNegocioRepository {
  constructor(@Inject(DB_CONNECTION) private readonly db: Database) {}

  async listar(): Promise<TipoNegocio[]> {
    return this.db
      .selectFrom('tipo_negocio')
      .select(['id', 'nombre'])
      .where('deleted_at', 'is', null)
      .orderBy('nombre')
      .execute();
  }

  async crear(nombre: string): Promise<TipoNegocio> {
    return this.db
      .insertInto('tipo_negocio')
      .values({ nombre })
      .returning(['id', 'nombre'])
      .executeTakeFirstOrThrow();
  }
}
