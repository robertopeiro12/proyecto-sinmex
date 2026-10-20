import { Inject, Injectable } from '@nestjs/common';
import { sql, type Transaction } from 'kysely';
import { DB_CONNECTION, type Database } from '../../database/database.tokens';
import type { DB } from '../../database/schema';
import { buscarSucursalUsuario } from '../sucursales/buscar-sucursal-usuario';
import type {
  EstadoCarga,
  FilaCarga,
  LineaCarga,
  PresentacionRejilla,
  RespuestaCarga,
  SucursalRejilla,
} from './reglas-carga';

/** Que cargas leer: una, las de la rejilla, o las del vendedor del token para el pull. */
export type FiltroCargas =
  | { id: string }
  | { sucursalId: string; fecha: string }
  | { vendedorId: string; desde: Date | null };

export interface VendedorParaCarga {
  id: string;
  nombre: string;
  activo: boolean;
  sucursalId: string;
  sucursalCodigo: string;
}

export interface NuevaCarga {
  sucursalId: string;
  vendedorId: string;
  /** `AAAA-MM-DD`: hoy en Tijuana (D8). */
  fecha: string;
  numero: number;
  capturoUsuarioId: string;
}

/**
 * SQL de la carga del vendedor (T-27). Los metodos que escriben reciben la `trx`
 * del servicio; ninguno abre la suya.
 */
@Injectable()
export class CargasRepository {
  constructor(@Inject(DB_CONNECTION) private readonly db: Database) {}

  enTransaccion<T>(tarea: (trx: Transaction<DB>) => Promise<T>): Promise<T> {
    return this.db.transaction().execute(tarea);
  }

  buscarSucursalUsuario(
    usuarioId: string,
  ): Promise<{ id: string | null; codigo: string | null } | undefined> {
    return buscarSucursalUsuario(this.db, usuarioId);
  }

  /** Hoy en Tijuana, del reloj de Postgres (nunca UTC): la fecha de una carga nueva (D8). */
  async hoyEnTijuana(): Promise<string> {
    const r = await sql<{ hoy: string }>`
      select to_char((now() at time zone 'America/Tijuana')::date, 'YYYY-MM-DD') as hoy
    `.execute(this.db);
    return r.rows[0].hoy;
  }

  async sucursalPorId(id: string): Promise<SucursalRejilla | undefined> {
    return this.db
      .selectFrom('sucursal')
      .select(['id', 'codigo', 'nombre'])
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
  }

  /** El vendedor (vivo, activo o no) con su sucursal, para el alcance del POST. */
  async vendedorParaCarga(id: string): Promise<VendedorParaCarga | undefined> {
    return this.db
      .selectFrom('vendedor')
      .innerJoin('sucursal', 'sucursal.id', 'vendedor.sucursal_id')
      .select([
        'vendedor.id as id',
        'vendedor.nombre as nombre',
        'vendedor.activo as activo',
        'vendedor.sucursal_id as sucursalId',
        'sucursal.codigo as sucursalCodigo',
      ])
      .where('vendedor.id', '=', id)
      .where('vendedor.deleted_at', 'is', null)
      .executeTakeFirst();
  }

  /**
   * Las columnas de la rejilla: los vendedores activos de la sucursal y, ademas,
   * los que tienen una carga viva ese dia aunque ya esten desactivados (su
   * carga existe y alguien tiene que poder verla).
   */
  async vendedoresDeRejilla(
    sucursalId: string,
    fecha: string,
  ): Promise<{ id: string; nombre: string }[]> {
    return this.db
      .selectFrom('vendedor')
      .select(['id', 'nombre'])
      .where('sucursal_id', '=', sucursalId)
      .where('deleted_at', 'is', null)
      .where((eb) =>
        eb.or([
          eb('activo', '=', true),
          eb(
            'id',
            'in',
            eb
              .selectFrom('carga')
              .select('carga.vendedor_id')
              .where('carga.deleted_at', 'is', null)
              .where(sql<boolean>`carga.fecha = ${fecha}::date`),
          ),
        ]),
      )
      .execute();
  }

  /**
   * Las filas de la rejilla: presentaciones activas (viva, de un producto vivo y
   * activo) y las que las cargas del dia traen aunque ya no lo esten.
   */
  async presentacionesDeRejilla(
    referenciadas: readonly string[],
  ): Promise<PresentacionRejilla[]> {
    const activa = sql<boolean>`(pr.deleted_at is null and p.deleted_at is null and p.activo)`;
    let q = this.db
      .selectFrom('presentacion as pr')
      .innerJoin('producto as p', 'p.id', 'pr.producto_id')
      .select([
        'pr.id as id',
        'p.nombre as productoNombre',
        'pr.volumen as volumen',
        activa.as('activa'),
      ]);
    q =
      referenciadas.length > 0
        ? q.where((eb) =>
            eb.or([activa, eb('pr.id', 'in', [...referenciadas])]),
          )
        : q.where(activa);
    return q.execute();
  }

  /** De esos ids, los de presentaciones activas (la validacion del POST/PATCH). */
  async idsPresentacionesActivas(ids: readonly string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const filas = await this.db
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

  /**
   * Bloquea la fila del vendedor hasta el fin de la transaccion: dos capturas
   * simultaneas para el mismo vendedor calculan el numero una despues de la
   * otra. `for update` sobre las cargas no sirve: Postgres no lo permite con
   * `max()` y no bloquearia nada en la primera carga del dia. `for no key update`
   * como en la ruta diaria (T-37): no frena los inserts que solo referencian al
   * vendedor. El indice unico parcial es la red.
   */
  async bloquearVendedor(
    vendedorId: string,
    trx: Transaction<DB>,
  ): Promise<void> {
    await trx
      .selectFrom('vendedor')
      .select('id')
      .where('id', '=', vendedorId)
      .forNoKeyUpdate()
      .execute();
  }

  /** `max(numero vivo) + 1`: una baja logica libera su numero. */
  async siguienteNumero(
    vendedorId: string,
    fecha: string,
    trx: Transaction<DB>,
  ): Promise<number> {
    const fila = await trx
      .selectFrom('carga')
      .select(sql<number>`coalesce(max(numero), 0) + 1`.as('siguiente'))
      .where('vendedor_id', '=', vendedorId)
      .where(sql<boolean>`fecha = ${fecha}::date`)
      .where('deleted_at', 'is', null)
      .executeTakeFirstOrThrow();
    return Number(fila.siguiente);
  }

  async insertarCarga(
    nueva: NuevaCarga,
    trx: Transaction<DB>,
  ): Promise<string> {
    const { id } = await trx
      .insertInto('carga')
      .values({
        sucursal_id: nueva.sucursalId,
        vendedor_id: nueva.vendedorId,
        fecha: nueva.fecha,
        numero: nueva.numero,
        capturo_usuario_id: nueva.capturoUsuarioId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return id;
  }

  async insertarLineas(
    cargaId: string,
    lineas: readonly LineaCarga[],
    trx: Transaction<DB>,
  ): Promise<void> {
    await trx
      .insertInto('carga_detalle')
      .values(
        lineas.map((l) => ({
          carga_id: cargaId,
          presentacion_id: l.presentacionId,
          piezas: l.piezas,
        })),
      )
      .execute();
  }

  /**
   * Bloquea la carga viva (`for update`) y la devuelve con sus lineas y el codigo
   * de su sucursal; `undefined` si no existe o esta dada de baja. El candado va
   * sobre `carga` sola: con un join, `for update` bloquearia tambien la sucursal.
   */
  async bloquearCarga(
    id: string,
    trx: Transaction<DB>,
  ): Promise<(FilaCarga & { sucursalCodigo: string }) | undefined> {
    const viva = await trx
      .selectFrom('carga')
      .select('id')
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .forUpdate()
      .executeTakeFirst();
    if (!viva) return undefined;
    const [carga] = await this.leerCargas({ id }, trx);
    const { codigo } = await trx
      .selectFrom('sucursal')
      .select('codigo')
      .where('id', '=', carga.sucursalId)
      .executeTakeFirstOrThrow();
    return { ...carga, sucursalCodigo: codigo };
  }

  async reemplazarLineas(
    cargaId: string,
    lineas: readonly LineaCarga[],
    trx: Transaction<DB>,
  ): Promise<void> {
    await trx
      .deleteFrom('carga_detalle')
      .where('carga_id', '=', cargaId)
      .execute();
    await this.insertarLineas(cargaId, lineas, trx);
  }

  /**
   * Editar la regresa a pendiente (D5): sube la version, limpia motivo y
   * respuesta (los dos checks piden las tres cosas juntas) y, por el trigger,
   * mueve `updated_at`, asi que la tablet la vuelve a bajar.
   */
  async marcarEditada(cargaId: string, trx: Transaction<DB>): Promise<void> {
    await trx
      .updateTable('carga')
      .set({
        version: sql<number>`version + 1`,
        estado: 'pendiente',
        motivo_rechazo: null,
        respondida_en: null,
      })
      .where('id', '=', cargaId)
      .execute();
  }

  /** Baja logica: libera el numero y viaja a la tablet como `activo: 0`. */
  async darDeBaja(cargaId: string, trx: Transaction<DB>): Promise<void> {
    await trx
      .updateTable('carga')
      .set({ deleted_at: sql<Date>`now()` })
      .where('id', '=', cargaId)
      .execute();
  }

  /** ¿El vendedor del token sigue vivo y activo? (El guard valido la firma, no eso.) */
  async vendedorActivo(vendedorId: string): Promise<boolean> {
    const fila = await this.db
      .selectFrom('vendedor')
      .select('id')
      .where('id', '=', vendedorId)
      .where('activo', '=', true)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    return fila !== undefined;
  }

  /** Escribe la respuesta del vendedor (D2): estado, motivo y `respondida_en = now()`. */
  async escribirRespuesta(
    cargaId: string,
    respuesta: RespuestaCarga,
    trx: Transaction<DB>,
  ): Promise<void> {
    await trx
      .updateTable('carga')
      .set({
        estado: respuesta.estado,
        motivo_rechazo: respuesta.motivo,
        respondida_en: sql<Date>`now()`,
      })
      .where('id', '=', cargaId)
      .execute();
  }

  /**
   * Las cargas del filtro con sus lineas. `fecha` sale como texto de Postgres:
   * el driver la convertiria a `Date` en la hora local del proceso.
   */
  async leerCargas(
    filtro: FiltroCargas,
    conexion: Database = this.db,
  ): Promise<FilaCarga[]> {
    let q = conexion
      .selectFrom('carga')
      .select([
        'id',
        'vendedor_id',
        'sucursal_id',
        sql<string>`to_char(fecha, 'YYYY-MM-DD')`.as('fecha'),
        'numero',
        'estado',
        'motivo_rechazo',
        'version',
        'respondida_en',
        'deleted_at',
      ]);
    if ('id' in filtro) {
      q = q.where('id', '=', filtro.id);
    } else if ('sucursalId' in filtro) {
      q = q
        .where('sucursal_id', '=', filtro.sucursalId)
        .where(sql<boolean>`fecha = ${filtro.fecha}::date`)
        .where('deleted_at', 'is', null);
    } else {
      // El pull: las del vendedor del token desde AYER por el reloj de Postgres
      // (UTC), como `rutas` (T-37): el `- 1` mantiene "hoy en Tijuana" dentro de
      // la ventana despues de las 17:00 locales. Sin `desde`, solo las vivas; con
      // `desde`, todo lo que cambio (una baja viaja como `activo: 0`).
      q = q
        .where('vendedor_id', '=', filtro.vendedorId)
        .where(sql<boolean>`fecha >= current_date - 1`);
      q = filtro.desde
        ? q.where('updated_at', '>', filtro.desde)
        : q.where('deleted_at', 'is', null);
    }
    const filas = await q.orderBy('fecha').orderBy('numero').execute();
    if (filas.length === 0) return [];

    const lineas = await conexion
      .selectFrom('carga_detalle')
      .select(['carga_id', 'presentacion_id', 'piezas'])
      .where(
        'carga_id',
        'in',
        filas.map((f) => f.id),
      )
      .execute();
    const porCarga = new Map<string, LineaCarga[]>();
    for (const l of lineas) {
      const lista = porCarga.get(l.carga_id) ?? [];
      lista.push({ presentacionId: l.presentacion_id, piezas: l.piezas });
      porCarga.set(l.carga_id, lista);
    }

    return filas.map((f) => ({
      id: f.id,
      vendedorId: f.vendedor_id,
      sucursalId: f.sucursal_id,
      fecha: f.fecha,
      numero: f.numero,
      // El check `estado in (...)` de la base garantiza uno de los tres.
      estado: f.estado as EstadoCarga,
      motivoRechazo: f.motivo_rechazo,
      version: f.version,
      respondidaEn: f.respondida_en,
      eliminada: f.deleted_at !== null,
      lineas: porCarga.get(f.id) ?? [],
    }));
  }
}
