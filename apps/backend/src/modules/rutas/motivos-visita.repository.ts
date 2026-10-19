import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DB_CONNECTION, type Database } from '../../database/database.tokens';

/** Un motivo tal como lo ve el portal (camelCase, como el resto de `rutas/`). */
export interface MotivoVisita {
  id: string;
  nombre: string;
  exigeFoto: boolean;
  exigeAtendio: boolean;
}

/** Lo que se puede cambiar de un motivo, ya con nombres de columna. */
export interface CambiosMotivoVisita {
  nombre?: string;
  exige_foto?: boolean;
  exige_atendio?: boolean;
}

interface FilaMotivo {
  id: string;
  nombre: string;
  exige_foto: boolean;
  exige_atendio: boolean;
}

function aMotivo(f: FilaMotivo): MotivoVisita {
  return {
    id: f.id,
    nombre: f.nombre,
    exigeFoto: f.exige_foto,
    exigeAtendio: f.exige_atendio,
  };
}

/**
 * SQL del catalogo `motivo_visita` (T-39, D1/D5). Global: no cuelga de una
 * sucursal, igual que `tipo_negocio`. La baja es logica (`deleted_at`) y el
 * trigger `set_actualizado_en` mueve `actualizado_en` en cualquier update, que
 * es lo que hace bajar la baja en el pull incremental.
 */
@Injectable()
export class MotivosVisitaRepository {
  constructor(@Inject(DB_CONNECTION) private readonly db: Database) {}

  async listarVivos(): Promise<MotivoVisita[]> {
    const filas = await this.db
      .selectFrom('motivo_visita')
      .select(['id', 'nombre', 'exige_foto', 'exige_atendio'])
      .where('deleted_at', 'is', null)
      .orderBy('nombre')
      .execute();
    return filas.map(aMotivo);
  }

  /** Lanza el `23505` de `uq_motivo_visita_nombre` tal cual: lo traduce el servicio. */
  async crear(
    nombre: string,
    exigeFoto: boolean,
    exigeAtendio: boolean,
  ): Promise<MotivoVisita> {
    const fila = await this.db
      .insertInto('motivo_visita')
      .values({ nombre, exige_foto: exigeFoto, exige_atendio: exigeAtendio })
      .returning(['id', 'nombre', 'exige_foto', 'exige_atendio'])
      .executeTakeFirstOrThrow();
    return aMotivo(fila);
  }

  /** `undefined` si no existe o ya estaba dado de baja. */
  async editar(
    id: string,
    cambios: CambiosMotivoVisita,
  ): Promise<MotivoVisita | undefined> {
    const fila = await this.db
      .updateTable('motivo_visita')
      .set(cambios)
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .returning(['id', 'nombre', 'exige_foto', 'exige_atendio'])
      .executeTakeFirst();
    return fila ? aMotivo(fila) : undefined;
  }

  /** `false` si no existe o ya estaba dado de baja. */
  async darDeBaja(id: string): Promise<boolean> {
    const fila = await this.db
      .updateTable('motivo_visita')
      .set({ deleted_at: sql`now()` })
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .returning('id')
      .executeTakeFirst();
    return fila !== undefined;
  }
}
