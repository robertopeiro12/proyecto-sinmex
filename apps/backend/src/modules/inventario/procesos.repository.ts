import { Inject, Injectable } from '@nestjs/common';
import { sql, type Kysely, type Transaction } from 'kysely';
import { DB_CONNECTION, type Database } from '../../database/database.tokens';
import type { DB } from '../../database/schema';
import { buscarSucursalUsuario } from '../sucursales/buscar-sucursal-usuario';
import type {
  EntradaProcesoLimpia,
  LineaProcesoLimpia,
  MermaDe,
  Sentido,
  TipoProceso,
} from './reglas-procesos';

/** Lo que el resumen de Procesos lee del cliente. */
export interface ClienteResumen {
  id: string;
  nombre: string;
  tipo: 'cliente' | 'prospecto';
  tipoNegocio: string | null;
  diasCredito: number | null;
  sucursalCodigo: string;
  /** `AAAA-MM-DD` de su venta viva mas reciente; `null` si nunca ha comprado. */
  ultimaCompra: string | null;
}

/** Un proceso tal como sale de la base, sin lineas. */
export interface FilaProceso {
  id: string;
  tipo: TipoProceso;
  sucursalId: string;
  sucursalCodigo: string;
  /** `AAAA-MM-DD`. */
  fecha: string;
  mermaDe: MermaDe | null;
  clienteId: string | null;
  clienteNombre: string | null;
  vendedorId: string | null;
  vendedorNombre: string | null;
  comentario: string | null;
  capturo: string;
  /** `HH24:MI` de Tijuana, de `created_at`. */
  hora: string;
  /** `updated_at` como ISO UTC con microsegundos (formateado en SQL). */
  actualizadoEn: string;
}

export interface FilaLineaProceso {
  procesoId: string;
  presentacionId: string;
  /** "Horchata 500 ml". */
  nombre: string;
  sentido: Sentido;
  piezas: number;
}

/**
 * SQL de Operacion -> Procesos (tablas `proceso_oficina*`). Los metodos que
 * escriben reciben la `trx` del servicio; ninguno abre la suya.
 */
@Injectable()
export class ProcesosRepository {
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
  ): Promise<{ id: string; codigo: string } | undefined> {
    return this.db
      .selectFrom('sucursal')
      .select(['id', 'codigo'])
      .where('codigo', '=', codigo)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
  }

  /** Los procesos vivos de un tipo, sucursal y dia (de un cliente, si se pide), por hora de captura. */
  async listar(
    sucursalId: string,
    fecha: string,
    tipo: TipoProceso,
    clienteId: string | null,
  ): Promise<FilaProceso[]> {
    let q = this.consulta(this.db)
      .where('p.sucursal_id', '=', sucursalId)
      .where('p.tipo', '=', tipo)
      .where(sql<boolean>`p.fecha = ${fecha}::date`);
    if (clienteId !== null) q = q.where('p.cliente_id', '=', clienteId);
    return q.orderBy('p.created_at').orderBy('p.id').execute() as Promise<
      FilaProceso[]
    >;
  }

  async porId(
    id: string,
    db: Kysely<DB> = this.db,
  ): Promise<FilaProceso | undefined> {
    return this.consulta(db)
      .where('p.id', '=', id)
      .executeTakeFirst() as Promise<FilaProceso | undefined>;
  }

  /** Bloquea la fila (`for update`) y la devuelve; `undefined` si esta dada de baja. */
  async bloquear(
    id: string,
    trx: Transaction<DB>,
  ): Promise<FilaProceso | undefined> {
    const vivo = await trx
      .selectFrom('proceso_oficina')
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
      .selectFrom('proceso_oficina as p')
      .innerJoin('sucursal as s', 's.id', 'p.sucursal_id')
      .innerJoin('usuario as u', 'u.id', 'p.capturo_usuario_id')
      .leftJoin('cliente as c', 'c.id', 'p.cliente_id')
      .leftJoin('vendedor as v', 'v.id', 'p.vendedor_id')
      .select([
        'p.id as id',
        'p.tipo as tipo',
        'p.sucursal_id as sucursalId',
        's.codigo as sucursalCodigo',
        sql<string>`to_char(p.fecha, 'YYYY-MM-DD')`.as('fecha'),
        'p.merma_de as mermaDe',
        'p.cliente_id as clienteId',
        'c.nombre as clienteNombre',
        'p.vendedor_id as vendedorId',
        'v.nombre as vendedorNombre',
        'p.comentario as comentario',
        'u.nombre as capturo',
        sql<string>`to_char(p.created_at at time zone 'America/Tijuana', 'HH24:MI')`.as(
          'hora',
        ),
        sql<string>`to_char(p.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`.as(
          'actualizadoEn',
        ),
      ])
      .where('p.deleted_at', 'is', null);
  }

  /** Las lineas de varios procesos, en el orden del catalogo (recibido antes que entregado). */
  async lineasDe(
    ids: readonly string[],
    db: Kysely<DB> = this.db,
  ): Promise<FilaLineaProceso[]> {
    if (ids.length === 0) return [];
    return db
      .selectFrom('proceso_oficina_linea as l')
      .innerJoin('presentacion as pr', 'pr.id', 'l.presentacion_id')
      .innerJoin('producto as pd', 'pd.id', 'pr.producto_id')
      .select([
        'l.proceso_id as procesoId',
        'l.presentacion_id as presentacionId',
        sql<string>`pd.nombre || ' ' || pr.volumen`.as('nombre'),
        sql<Sentido>`l.sentido`.as('sentido'),
        'l.piezas as piezas',
      ])
      .where('l.proceso_id', 'in', [...ids])
      .orderBy(sql`case l.sentido when 'recibido' then 0 else 1 end`)
      .orderBy('pd.nombre')
      .orderBy('pr.volumen')
      .orderBy('pr.id')
      .execute();
  }

  async idsPresentacionesDe(
    procesoId: string,
    trx: Transaction<DB>,
  ): Promise<Set<string>> {
    const filas = await trx
      .selectFrom('proceso_oficina_linea')
      .select('presentacion_id')
      .where('proceso_id', '=', procesoId)
      .execute();
    return new Set(filas.map((f) => f.presentacion_id));
  }

  /** De esos ids, las presentaciones vivas de un producto vivo y activo. */
  async idsPresentacionesActivas(
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
      .where('p.activo', '=', true)
      .execute();
    return new Set(filas.map((f) => f.id));
  }

  /** Un cliente (o prospecto) vivo de esa sucursal. */
  /**
   * El cliente vivo (o prospecto) para el resumen de Procesos, con su tipo de
   * negocio, dias de credito y la fecha de su venta viva mas reciente.
   */
  async clienteResumen(id: string): Promise<ClienteResumen | undefined> {
    return this.db
      .selectFrom('cliente as c')
      .innerJoin('sucursal as s', 's.id', 'c.sucursal_id')
      .leftJoin('tipo_negocio as tn', 'tn.id', 'c.tipo_negocio_id')
      .select([
        'c.id as id',
        'c.nombre as nombre',
        sql<'cliente' | 'prospecto'>`c.tipo`.as('tipo'),
        'tn.nombre as tipoNegocio',
        'c.plazo_credito_dias as diasCredito',
        's.codigo as sucursalCodigo',
        sql<string | null>`(
          select to_char(max(vn.fecha), 'YYYY-MM-DD')
            from venta_nota vn
           where vn.cliente_id = c.id
             and vn.deleted_at is null
        )`.as('ultimaCompra'),
      ])
      .where('c.id', '=', id)
      .where('c.deleted_at', 'is', null)
      .executeTakeFirst();
  }

  async clienteDeSucursal(
    clienteId: string,
    sucursalId: string,
    trx: Transaction<DB>,
  ): Promise<boolean> {
    const c = await trx
      .selectFrom('cliente')
      .select('id')
      .where('id', '=', clienteId)
      .where('sucursal_id', '=', sucursalId)
      .where('deleted_at', 'is', null)
      .where('tipo', 'in', ['cliente', 'prospecto'])
      .executeTakeFirst();
    return c !== undefined;
  }

  /** Un vendedor vivo de esa sucursal (activo o no: la operacion ya paso). */
  async vendedorDeSucursal(
    vendedorId: string,
    sucursalId: string,
    trx: Transaction<DB>,
  ): Promise<boolean> {
    const v = await trx
      .selectFrom('vendedor')
      .select('id')
      .where('id', '=', vendedorId)
      .where('sucursal_id', '=', sucursalId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    return v !== undefined;
  }

  async insertar(
    sucursalId: string,
    datos: EntradaProcesoLimpia,
    usuarioId: string,
    trx: Transaction<DB>,
  ): Promise<string> {
    const { id } = await trx
      .insertInto('proceso_oficina')
      .values({
        sucursal_id: sucursalId,
        tipo: datos.tipo,
        fecha: sql<Date>`${datos.fecha}::date`,
        merma_de: datos.mermaDe,
        cliente_id: datos.clienteId,
        vendedor_id: datos.vendedorId,
        comentario: datos.comentario,
        capturo_usuario_id: usuarioId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return id;
  }

  async actualizar(
    id: string,
    datos: EntradaProcesoLimpia,
    usuarioId: string,
    trx: Transaction<DB>,
  ): Promise<void> {
    await trx
      .updateTable('proceso_oficina')
      .set({
        fecha: sql<Date>`${datos.fecha}::date`,
        merma_de: datos.mermaDe,
        cliente_id: datos.clienteId,
        vendedor_id: datos.vendedorId,
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
      .updateTable('proceso_oficina')
      .set({ deleted_at: sql`now()`, actualizado_por_usuario_id: usuarioId })
      .where('id', '=', id)
      .execute();
  }

  /** Las lineas no tienen baja logica: editar las reemplaza todas. */
  async reemplazarLineas(
    procesoId: string,
    lineas: readonly LineaProcesoLimpia[],
    trx: Transaction<DB>,
  ): Promise<void> {
    await trx
      .deleteFrom('proceso_oficina_linea')
      .where('proceso_id', '=', procesoId)
      .execute();
    if (lineas.length === 0) return;
    await trx
      .insertInto('proceso_oficina_linea')
      .values(
        lineas.map((l) => ({
          proceso_id: procesoId,
          presentacion_id: l.presentacionId,
          sentido: l.sentido,
          piezas: l.piezas,
        })),
      )
      .execute();
  }
}
