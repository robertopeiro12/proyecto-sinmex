import { Inject, Injectable } from '@nestjs/common';
import { sql, type Kysely, type Transaction } from 'kysely';
import { DB_CONNECTION, type Database } from '../../database/database.tokens';
import type { DB } from '../../database/schema';
import { buscarSucursalUsuario } from '../sucursales/buscar-sucursal-usuario';
import type { FilaViva, LineaPedida } from './reglas-produccion';

export interface SucursalProduccion {
  id: string;
  codigo: string;
}

/** Una presentacion del dia con lo producido (0 si no hay fila viva). */
export interface LineaDelDia {
  presentacionId: string;
  producto: string;
  presentacion: string;
  activa: boolean;
  piezas: number;
}

/** Que dia de que sucursal. */
export interface DiaSucursal {
  sucursalId: string;
  /** `AAAA-MM-DD`. */
  fecha: string;
}

/** Activa = presentacion y producto vivos y el producto activo (como en las cargas). */
const ACTIVA = sql<boolean>`(pr.deleted_at is null and p.deleted_at is null and p.activo)`;

/**
 * SQL de la produccion por dia (T-25). Los metodos que escriben reciben la `trx`
 * del servicio; ninguno abre la suya.
 */
@Injectable()
export class ProduccionRepository {
  constructor(@Inject(DB_CONNECTION) private readonly db: Database) {}

  enTransaccion<T>(tarea: (trx: Transaction<DB>) => Promise<T>): Promise<T> {
    return this.db.transaction().execute(tarea);
  }

  buscarSucursalUsuario(
    usuarioId: string,
  ): Promise<{ id: string | null; codigo: string | null } | undefined> {
    return buscarSucursalUsuario(this.db, usuarioId);
  }

  /** Hoy en Tijuana, del reloj de Postgres (nunca UTC): el tope de la fecha. */
  async hoyEnTijuana(): Promise<string> {
    const r = await sql<{ hoy: string }>`
      select to_char((now() at time zone 'America/Tijuana')::date, 'YYYY-MM-DD') as hoy
    `.execute(this.db);
    return r.rows[0].hoy;
  }

  async sucursalPorCodigo(
    codigo: string,
  ): Promise<SucursalProduccion | undefined> {
    return this.db
      .selectFrom('sucursal')
      .select(['id', 'codigo'])
      .where('codigo', '=', codigo)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
  }

  /**
   * Bloquea la fila de la sucursal hasta el fin de la transaccion: dos guardados
   * del mismo dia y sucursal se aplican uno despues del otro, tambien el primero
   * (cuando aun no hay filas de `produccion` que bloquear). Mismo patron que la
   * fila del vendedor en las cargas: `for no key update` no frena los inserts
   * que solo referencian a la sucursal. El indice unico parcial queda de red.
   */
  async bloquearSucursal(
    sucursalId: string,
    trx: Transaction<DB>,
  ): Promise<void> {
    await trx
      .selectFrom('sucursal')
      .select('id')
      .where('id', '=', sucursalId)
      .forNoKeyUpdate()
      .execute();
  }

  /**
   * Las filas vivas del dia, bloqueadas (`for update`), ya con la sucursal
   * bloqueada por `bloquearSucursal`.
   */
  async bloquearVivas(
    dia: DiaSucursal,
    trx: Transaction<DB>,
  ): Promise<FilaViva[]> {
    return trx
      .selectFrom('produccion')
      .select(['id', 'presentacion_id as presentacionId', 'piezas'])
      .where('sucursal_id', '=', dia.sucursalId)
      .where(sql<boolean>`fecha = ${dia.fecha}::date`)
      .where('deleted_at', 'is', null)
      .forUpdate()
      .execute();
  }

  /**
   * De esos ids, los que se pueden capturar: presentaciones vivas de un producto
   * vivo (activo o no). La desactivada entra para poder volver a guardar un dia
   * que ya la tenia; la dada de baja solo si ya tiene fila viva ese dia (la
   * revisa el servicio con las vivas).
   */
  async idsPresentacionesVivas(
    ids: readonly string[],
    trx: Transaction<DB>,
  ): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const filas = await trx
      .selectFrom('presentacion as pr')
      .innerJoin('producto as p', 'p.id', 'pr.producto_id')
      .select('pr.id as id')
      .where('pr.id', 'in', [...ids])
      .where('pr.deleted_at', 'is', null)
      .where('p.deleted_at', 'is', null)
      .execute();
    return new Set(filas.map((f) => f.id));
  }

  async insertar(
    dia: DiaSucursal,
    lineas: readonly LineaPedida[],
    usuarioId: string,
    trx: Transaction<DB>,
  ): Promise<void> {
    if (lineas.length === 0) return;
    await trx
      .insertInto('produccion')
      .values(
        lineas.map((l) => ({
          fecha: sql<Date>`${dia.fecha}::date`,
          sucursal_id: dia.sucursalId,
          presentacion_id: l.presentacionId,
          piezas: l.piezas,
          capturo_usuario_id: usuarioId,
        })),
      )
      .execute();
  }

  async actualizar(
    cambios: readonly { id: string; piezas: number }[],
    usuarioId: string,
    trx: Transaction<DB>,
  ): Promise<void> {
    for (const c of cambios) {
      await trx
        .updateTable('produccion')
        .set({ piezas: c.piezas, actualizado_por_usuario_id: usuarioId })
        .where('id', '=', c.id)
        .execute();
    }
  }

  /** Baja logica: libera el lugar en el indice unico para volver a capturar. */
  async darDeBaja(
    ids: readonly string[],
    usuarioId: string,
    trx: Transaction<DB>,
  ): Promise<void> {
    if (ids.length === 0) return;
    await trx
      .updateTable('produccion')
      .set({ deleted_at: sql`now()`, actualizado_por_usuario_id: usuarioId })
      .where('id', 'in', [...ids])
      .execute();
  }

  /**
   * Todas las presentaciones activas mas las que tengan piezas ese dia aunque ya
   * no esten activas (no se esconde lo capturado), en el orden del catalogo:
   * producto y luego presentacion. `presentacion` no tiene un tamano numerico:
   * se ordena por `volumen` (texto, "1 L" antes que "500 ml") igual que el
   * catalogo de productos y el pull.
   */
  async lineasDelDia(
    dia: DiaSucursal,
    db: Kysely<DB> = this.db,
  ): Promise<LineaDelDia[]> {
    const filas = await db
      .selectFrom('presentacion as pr')
      .innerJoin('producto as p', 'p.id', 'pr.producto_id')
      .leftJoin('produccion as pd', (join) =>
        join
          .onRef('pd.presentacion_id', '=', 'pr.id')
          .on('pd.sucursal_id', '=', dia.sucursalId)
          .on(sql<boolean>`pd.fecha = ${dia.fecha}::date`)
          .on('pd.deleted_at', 'is', null),
      )
      .select([
        'pr.id as presentacionId',
        'p.nombre as producto',
        'pr.volumen as presentacion',
        ACTIVA.as('activa'),
        sql<number>`coalesce(pd.piezas, 0)`.as('piezas'),
      ])
      .where((eb) => eb.or([ACTIVA, eb('pd.id', 'is not', null)]))
      .orderBy('p.nombre')
      .orderBy('pr.volumen')
      .orderBy('pr.id')
      .execute();
    return filas;
  }

  /** El ultimo cambio del dia (altas, correcciones y bajas); `null` si nunca se capturo. */
  async actualizadoEn(
    dia: DiaSucursal,
    db: Kysely<DB> = this.db,
  ): Promise<Date | null> {
    const r = await db
      .selectFrom('produccion')
      .select(sql<Date | null>`max(updated_at)`.as('ultimo'))
      .where('sucursal_id', '=', dia.sucursalId)
      .where(sql<boolean>`fecha = ${dia.fecha}::date`)
      .executeTakeFirst();
    return r?.ultimo ?? null;
  }
}
