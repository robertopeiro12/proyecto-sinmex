import { Inject, Injectable } from '@nestjs/common';
import { sql, type Kysely, type Transaction } from 'kysely';
import { DB_CONNECTION, type Database } from '../../database/database.tokens';
import type { DB } from '../../database/schema';
import { buscarSucursalUsuario } from '../sucursales/buscar-sucursal-usuario';
import type {
  EstadoRetiro,
  LineaPedida,
  LineaViva,
  TipoOperacion,
} from './reglas-operacion';

export interface SucursalOperacion {
  id: string;
  codigo: string;
}

/** Una operacion tal como sale de la base, sin lineas. */
export interface FilaOperacion {
  id: string;
  tipo: TipoOperacion;
  sucursalId: string;
  sucursalCodigo: string;
  /** `AAAA-MM-DD`. */
  fecha: string;
  origen: string | null;
  destinoId: string | null;
  destinoCodigo: string | null;
  motivoId: string | null;
  motivoNombre: string | null;
  trabajador: string | null;
  comentario: string | null;
  capturo: string;
  /** `HH:MI` de Tijuana, de `created_at`. */
  hora: string;
  /** Solo `retiro_merma`; null en los demas tipos. */
  estado: EstadoRetiro | null;
  resueltoPor: string | null;
  /** `AAAA-MM-DD HH24:MI` de Tijuana. */
  resueltoEn: string | null;
  motivoRechazo: string | null;
}

export interface LineaOperacion {
  operacionId: string;
  presentacionId: string;
  nombre: string;
  producto: string;
  volumen: string;
  piezas: number;
}

/** Los datos que se escriben en `operacion_almacen` (ya validados). */
export interface DatosOperacion {
  fecha: string;
  origen: string | null;
  destinoId: string | null;
  motivoId: string | null;
  trabajador: string | null;
  comentario: string | null;
}

/**
 * SQL del Registro de Operacion (parte 1). Los metodos que escriben reciben la
 * `trx` del servicio; ninguno abre la suya.
 */
@Injectable()
export class OperacionesAlmacenRepository {
  constructor(@Inject(DB_CONNECTION) private readonly db: Database) {}

  enTransaccion<T>(tarea: (trx: Transaction<DB>) => Promise<T>): Promise<T> {
    return this.db.transaction().execute(tarea);
  }

  buscarSucursalUsuario(
    usuarioId: string,
  ): Promise<{ id: string | null; codigo: string | null } | undefined> {
    return buscarSucursalUsuario(this.db, usuarioId);
  }

  /** Hoy en Tijuana, del reloj de Postgres (nunca UTC). */
  async hoyEnTijuana(): Promise<string> {
    const r = await sql<{ hoy: string }>`
      select to_char((now() at time zone 'America/Tijuana')::date, 'YYYY-MM-DD') as hoy
    `.execute(this.db);
    return r.rows[0].hoy;
  }

  async sucursalPorCodigo(
    codigo: string,
    db: Kysely<DB> = this.db,
  ): Promise<SucursalOperacion | undefined> {
    return db
      .selectFrom('sucursal')
      .select(['id', 'codigo'])
      .where('codigo', '=', codigo)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
  }

  /** Las operaciones del dia de una sucursal; con `entrada`, tambien los envios que le llegan. */
  async listar(
    sucursalId: string,
    fecha: string,
    tipo: TipoOperacion,
  ): Promise<FilaOperacion[]> {
    return this.consulta(this.db)
      .where(sql<boolean>`o.fecha = ${fecha}::date`)
      .where((eb) =>
        tipo === 'entrada'
          ? eb.or([
              eb.and([
                eb('o.tipo', '=', 'entrada'),
                eb('o.sucursal_id', '=', sucursalId),
              ]),
              eb.and([
                eb('o.tipo', '=', 'envio'),
                eb('o.sucursal_destino_id', '=', sucursalId),
              ]),
            ])
          : eb.and([
              eb('o.tipo', '=', tipo),
              eb('o.sucursal_id', '=', sucursalId),
            ]),
      )
      .orderBy('o.created_at')
      .orderBy('o.id')
      .execute() as Promise<FilaOperacion[]>;
  }

  /** Los retiros pendientes (de una sucursal o de todas), en el orden en que se pidieron. */
  async pendientesDeRetiro(
    sucursalId: string | null,
  ): Promise<FilaOperacion[]> {
    let q = this.consulta(this.db)
      .where('o.tipo', '=', 'retiro_merma')
      .where('o.estado', '=', 'pendiente');
    if (sucursalId !== null) q = q.where('o.sucursal_id', '=', sucursalId);
    return q.orderBy('o.created_at').orderBy('o.id').execute() as Promise<
      FilaOperacion[]
    >;
  }

  /** Autoriza o rechaza (la fila ya esta bloqueada y pendiente). */
  async resolverRetiro(
    id: string,
    estado: 'autorizado' | 'rechazado',
    motivo: string | null,
    usuarioId: string,
    trx: Transaction<DB>,
  ): Promise<void> {
    await trx
      .updateTable('operacion_almacen')
      .set({
        estado,
        motivo_rechazo: motivo,
        resuelto_por_usuario_id: usuarioId,
        resuelto_en: sql`now()`,
      })
      .where('id', '=', id)
      .execute();
  }

  /** Un rechazado corregido vuelve a pendiente y pierde su resolucion. */
  async reabrirRetiro(id: string, trx: Transaction<DB>): Promise<void> {
    await trx
      .updateTable('operacion_almacen')
      .set({
        estado: 'pendiente',
        motivo_rechazo: null,
        resuelto_por_usuario_id: null,
        resuelto_en: null,
      })
      .where('id', '=', id)
      .execute();
  }

  async porId(
    id: string,
    db: Kysely<DB> = this.db,
  ): Promise<FilaOperacion | undefined> {
    return this.consulta(db)
      .where('o.id', '=', id)
      .executeTakeFirst() as Promise<FilaOperacion | undefined>;
  }

  /** Bloquea la fila de la operacion (`for update`) y la devuelve; `undefined` si esta dada de baja. */
  async bloquear(
    id: string,
    trx: Transaction<DB>,
  ): Promise<FilaOperacion | undefined> {
    const vivo = await trx
      .selectFrom('operacion_almacen')
      .select('id')
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .forUpdate()
      .executeTakeFirst();
    if (!vivo) return undefined;
    return this.porId(id, trx);
  }

  private consulta(db: Kysely<DB>) {
    return db
      .selectFrom('operacion_almacen as o')
      .innerJoin('sucursal as s', 's.id', 'o.sucursal_id')
      .innerJoin('usuario as u', 'u.id', 'o.capturo_usuario_id')
      .leftJoin('sucursal as d', 'd.id', 'o.sucursal_destino_id')
      .leftJoin('motivo_merma as m', 'm.id', 'o.motivo_merma_id')
      .leftJoin('usuario as r', 'r.id', 'o.resuelto_por_usuario_id')
      .select([
        'o.id as id',
        'o.tipo as tipo',
        'o.sucursal_id as sucursalId',
        's.codigo as sucursalCodigo',
        sql<string>`to_char(o.fecha, 'YYYY-MM-DD')`.as('fecha'),
        'o.origen as origen',
        'o.sucursal_destino_id as destinoId',
        'd.codigo as destinoCodigo',
        'o.motivo_merma_id as motivoId',
        'm.nombre as motivoNombre',
        'o.trabajador as trabajador',
        'o.comentario as comentario',
        'u.nombre as capturo',
        sql<string>`to_char(o.created_at at time zone 'America/Tijuana', 'HH24:MI')`.as(
          'hora',
        ),
        'o.estado as estado',
        'r.nombre as resueltoPor',
        sql<
          string | null
        >`to_char(o.resuelto_en at time zone 'America/Tijuana', 'YYYY-MM-DD HH24:MI')`.as(
          'resueltoEn',
        ),
        'o.motivo_rechazo as motivoRechazo',
      ])
      .where('o.deleted_at', 'is', null);
  }

  /** Las lineas de varias operaciones, en el orden del catalogo. */
  async lineasDe(
    ids: readonly string[],
    db: Kysely<DB> = this.db,
  ): Promise<LineaOperacion[]> {
    if (ids.length === 0) return [];
    return db
      .selectFrom('operacion_almacen_linea as l')
      .innerJoin('presentacion as pr', 'pr.id', 'l.presentacion_id')
      .innerJoin('producto as p', 'p.id', 'pr.producto_id')
      .select([
        'l.operacion_id as operacionId',
        'l.presentacion_id as presentacionId',
        sql<string>`p.nombre || ' ' || pr.volumen`.as('nombre'),
        'p.nombre as producto',
        'pr.volumen as volumen',
        'l.piezas as piezas',
      ])
      .where('l.operacion_id', 'in', [...ids])
      .orderBy('p.nombre')
      .orderBy('pr.volumen')
      .orderBy('pr.id')
      .execute();
  }

  async lineasVivas(
    operacionId: string,
    trx: Transaction<DB>,
  ): Promise<LineaViva[]> {
    return trx
      .selectFrom('operacion_almacen_linea')
      .select(['id', 'presentacion_id as presentacionId', 'piezas'])
      .where('operacion_id', '=', operacionId)
      .execute();
  }

  /** De esos ids, las presentaciones vivas de un producto vivo (activo o no). */
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

  /** Un motivo de merma: vivo (`activo`) o no, y si aplica a almacen. */
  async motivo(
    id: string,
    trx: Transaction<DB>,
  ): Promise<{ activo: boolean; aplicaAlmacen: boolean } | undefined> {
    const m = await trx
      .selectFrom('motivo_merma')
      .select(['deleted_at', 'aplica_almacen'])
      .where('id', '=', id)
      .executeTakeFirst();
    if (!m) return undefined;
    return { activo: m.deleted_at === null, aplicaAlmacen: m.aplica_almacen };
  }

  async insertar(
    sucursalId: string,
    tipo: TipoOperacion,
    datos: DatosOperacion,
    usuarioId: string,
    trx: Transaction<DB>,
  ): Promise<string> {
    const { id } = await trx
      .insertInto('operacion_almacen')
      .values({
        sucursal_id: sucursalId,
        tipo,
        fecha: sql<Date>`${datos.fecha}::date`,
        origen: datos.origen,
        sucursal_destino_id: datos.destinoId,
        motivo_merma_id: datos.motivoId,
        trabajador: datos.trabajador,
        comentario: datos.comentario,
        capturo_usuario_id: usuarioId,
        estado: tipo === 'retiro_merma' ? 'pendiente' : null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return id;
  }

  async actualizar(
    id: string,
    datos: DatosOperacion,
    usuarioId: string,
    trx: Transaction<DB>,
  ): Promise<void> {
    await trx
      .updateTable('operacion_almacen')
      .set({
        fecha: sql<Date>`${datos.fecha}::date`,
        origen: datos.origen,
        sucursal_destino_id: datos.destinoId,
        motivo_merma_id: datos.motivoId,
        trabajador: datos.trabajador,
        comentario: datos.comentario,
        actualizado_por_usuario_id: usuarioId,
      })
      .where('id', '=', id)
      .execute();
  }

  async darDeBaja(
    id: string,
    usuarioId: string,
    trx: Transaction<DB>,
  ): Promise<void> {
    await trx
      .updateTable('operacion_almacen')
      .set({ deleted_at: sql`now()`, actualizado_por_usuario_id: usuarioId })
      .where('id', '=', id)
      .execute();
  }

  async insertarLineas(
    operacionId: string,
    lineas: readonly LineaPedida[],
    trx: Transaction<DB>,
  ): Promise<void> {
    if (lineas.length === 0) return;
    await trx
      .insertInto('operacion_almacen_linea')
      .values(
        lineas.map((l) => ({
          operacion_id: operacionId,
          presentacion_id: l.presentacionId,
          piezas: l.piezas,
        })),
      )
      .execute();
  }

  async actualizarLineas(
    cambios: readonly { id: string; piezas: number }[],
    trx: Transaction<DB>,
  ): Promise<void> {
    for (const c of cambios) {
      await trx
        .updateTable('operacion_almacen_linea')
        .set({ piezas: c.piezas })
        .where('id', '=', c.id)
        .execute();
    }
  }

  /** Las lineas no tienen baja logica: una linea que ya no viene se borra. */
  async borrarLineas(
    ids: readonly string[],
    trx: Transaction<DB>,
  ): Promise<void> {
    if (ids.length === 0) return;
    await trx
      .deleteFrom('operacion_almacen_linea')
      .where('id', 'in', [...ids])
      .execute();
  }
}
