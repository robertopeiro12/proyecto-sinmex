import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DB_CONNECTION, type Database } from '../../database/database.tokens';
import type { TipoEgreso } from './tipos-egreso';

/** Un campo tal como lo ve el portal (camelCase). */
export interface CampoEgreso {
  id: string;
  nombre: string;
  tipo: TipoEgreso;
  seUsaEnApp: boolean;
}

/** Lo que se puede cambiar de un campo, ya con nombres de columna. */
export interface CambiosCampoEgreso {
  nombre?: string;
  tipo?: TipoEgreso;
  se_usa_en_app?: boolean;
}

interface FilaCampo {
  id: string;
  nombre: string;
  tipo: string;
  se_usa_en_app: boolean;
}

function aCampo(f: FilaCampo): CampoEgreso {
  return {
    id: f.id,
    nombre: f.nombre,
    // El check `ck_campo_egreso_tipo` garantiza uno de los tres.
    tipo: f.tipo as TipoEgreso,
    seUsaEnApp: f.se_usa_en_app,
  };
}

const COLUMNAS = ['id', 'nombre', 'tipo', 'se_usa_en_app'] as const;

/**
 * SQL del catalogo `campo_egreso` (T-30, D2/D3). Global, como `motivo_visita`.
 * La baja es logica y el trigger `set_actualizado_en` mueve `actualizado_en`
 * en cualquier update: es lo que hace bajar la baja en el pull incremental.
 */
@Injectable()
export class CamposEgresoRepository {
  constructor(@Inject(DB_CONNECTION) private readonly db: Database) {}

  async listarVivos(): Promise<CampoEgreso[]> {
    const filas = await this.db
      .selectFrom('campo_egreso')
      .select(COLUMNAS)
      .where('deleted_at', 'is', null)
      .orderBy('nombre')
      .execute();
    return filas.map(aCampo);
  }

  /** Lanza el `23505` de `uq_campo_egreso_nombre` tal cual: lo traduce el servicio. */
  async crear(
    nombre: string,
    tipo: TipoEgreso,
    seUsaEnApp: boolean,
  ): Promise<CampoEgreso> {
    const fila = await this.db
      .insertInto('campo_egreso')
      .values({ nombre, tipo, se_usa_en_app: seUsaEnApp })
      .returning(COLUMNAS)
      .executeTakeFirstOrThrow();
    return aCampo(fila);
  }

  /** `undefined` si no existe o ya estaba dado de baja. */
  async editar(
    id: string,
    cambios: CambiosCampoEgreso,
  ): Promise<CampoEgreso | undefined> {
    const fila = await this.db
      .updateTable('campo_egreso')
      .set(cambios)
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .returning(COLUMNAS)
      .executeTakeFirst();
    return fila ? aCampo(fila) : undefined;
  }

  /**
   * ¿Tiene el campo algun gasto VIVO con `fecha >= fecha`? (D2: no se da de
   * baja con gastos del año en curso). Un gasto borrado no cuenta. Usa
   * `idx_gasto_campo_fecha`.
   */
  async tieneGastosDesde(id: string, fecha: string): Promise<boolean> {
    const fila = await this.db
      .selectFrom('gasto')
      .select('id')
      .where('campo_egreso_id', '=', id)
      .where('deleted_at', 'is', null)
      // `fecha` es `date`: el schema la tipa como Timestamp, asi que se compara con un cast.
      .where('fecha', '>=', sql<Date>`${fecha}::date`)
      .limit(1)
      .executeTakeFirst();
    return fila !== undefined;
  }

  /** `false` si no existe o ya estaba dado de baja. */
  async darDeBaja(id: string): Promise<boolean> {
    const fila = await this.db
      .updateTable('campo_egreso')
      .set({ deleted_at: sql`now()` })
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .returning('id')
      .executeTakeFirst();
    return fila !== undefined;
  }
}
