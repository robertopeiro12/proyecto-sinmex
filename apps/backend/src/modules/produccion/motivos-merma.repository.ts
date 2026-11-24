import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DB_CONNECTION, type Database } from '../../database/database.tokens';

/** Un motivo de merma tal como lo ve el portal. `activo` = no dado de baja. */
export interface MotivoMerma {
  id: string;
  nombre: string;
  aplicaAlmacen: boolean;
  aplicaCliente: boolean;
  aplicaVehiculo: boolean;
  activo: boolean;
}

/** Lo que se puede cambiar de un motivo, ya con nombres de columna. */
export interface CambiosMotivoMerma {
  nombre?: string;
  aplica_almacen?: boolean;
  aplica_cliente?: boolean;
  aplica_vehiculo?: boolean;
}

interface FilaMotivo {
  id: string;
  nombre: string;
  aplica_almacen: boolean;
  aplica_cliente: boolean;
  aplica_vehiculo: boolean;
  deleted_at: Date | string | null;
}

const COLUMNAS = [
  'id',
  'nombre',
  'aplica_almacen',
  'aplica_cliente',
  'aplica_vehiculo',
  'deleted_at',
] as const;

function aMotivo(f: FilaMotivo): MotivoMerma {
  return {
    id: f.id,
    nombre: f.nombre,
    aplicaAlmacen: f.aplica_almacen,
    aplicaCliente: f.aplica_cliente,
    aplicaVehiculo: f.aplica_vehiculo,
    activo: f.deleted_at === null,
  };
}

/**
 * SQL del catalogo `motivo_merma` (Registro de Operacion, D7). Global, como
 * `motivo_visita`. La baja es logica (`deleted_at`).
 */
@Injectable()
export class MotivosMermaRepository {
  constructor(@Inject(DB_CONNECTION) private readonly db: Database) {}

  async listarVivos(soloAlmacen: boolean): Promise<MotivoMerma[]> {
    let consulta = this.db
      .selectFrom('motivo_merma')
      .select(COLUMNAS)
      .where('deleted_at', 'is', null);
    if (soloAlmacen) consulta = consulta.where('aplica_almacen', '=', true);
    const filas = await consulta.orderBy('nombre').execute();
    return filas.map(aMotivo);
  }

  /** Un motivo vivo, o `undefined`. */
  async obtenerVivo(id: string): Promise<MotivoMerma | undefined> {
    const fila = await this.db
      .selectFrom('motivo_merma')
      .select(COLUMNAS)
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    return fila ? aMotivo(fila) : undefined;
  }

  /** Lanza el `23505` del unico por nombre tal cual: lo traduce el servicio. */
  async crear(
    nombre: string,
    aplicaAlmacen: boolean,
    aplicaCliente: boolean,
    aplicaVehiculo: boolean,
  ): Promise<MotivoMerma> {
    const fila = await this.db
      .insertInto('motivo_merma')
      .values({
        nombre,
        aplica_almacen: aplicaAlmacen,
        aplica_cliente: aplicaCliente,
        aplica_vehiculo: aplicaVehiculo,
      })
      .returning(COLUMNAS)
      .executeTakeFirstOrThrow();
    return aMotivo(fila);
  }

  /** `undefined` si no existe o ya estaba dado de baja. */
  async editar(
    id: string,
    cambios: CambiosMotivoMerma,
  ): Promise<MotivoMerma | undefined> {
    const fila = await this.db
      .updateTable('motivo_merma')
      .set(cambios)
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .returning(COLUMNAS)
      .executeTakeFirst();
    return fila ? aMotivo(fila) : undefined;
  }

  /** `false` si no existe o ya estaba dado de baja. */
  async darDeBaja(id: string): Promise<boolean> {
    const fila = await this.db
      .updateTable('motivo_merma')
      .set({ deleted_at: sql`now()` })
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .returning('id')
      .executeTakeFirst();
    return fila !== undefined;
  }
}
