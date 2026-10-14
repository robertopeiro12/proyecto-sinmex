import { Inject, Injectable } from '@nestjs/common';
import type { Transaction } from 'kysely';
import { DB_CONNECTION, type Database } from '../../database/database.tokens';
import type { DB } from '../../database/schema';
import type {
  AudienciaPromocion,
  CompraPromocion,
  RegaloPromocion,
} from '../sincronizacion/contrato';
import { buscarSucursalUsuario as buscarSucursalUsuarioCompartido } from '../sucursales/buscar-sucursal-usuario';
import type { ReglaCompleta } from './reglas-promocion';

/** Una promocion como la pinta el portal (camelCase). `texto` lo pone el servicio. */
export interface Promocion extends ReglaCompleta {
  id: string;
  sucursalId: string;
  sucursalCodigo: string;
  activo: boolean;
  clienteNombre: string | null;
  /** Nombre del producto, o "producto volumen"; `null` si no aplica. */
  compraNombre: string | null;
  regaloNombre: string | null;
  /** Producto que cubre la compra (el de la presentacion si es por presentacion); `null` = cualquiera. */
  compraProductoCubierto: string | null;
  texto: string;
  /** Solo en `GET ?clienteId=`: una general que una propia del cliente desplaza (D5). */
  desplazada?: boolean;
}

/** Fila lista para escribir. */
export interface NuevaPromocion extends ReglaCompleta {
  sucursalId: string;
}

type FilaPromocion = {
  id: string;
  sucursal_id: string;
  sucursal_codigo: string;
  activo: boolean;
  audiencia: string;
  cliente_id: string | null;
  cliente_nombre: string | null;
  compra_tipo: string;
  compra_producto_id: string | null;
  compra_presentacion_id: string | null;
  compra_cantidad: number;
  regalo_tipo: string;
  regalo_producto_id: string | null;
  regalo_presentacion_id: string | null;
  regalo_cantidad: number;
  se_repite: boolean;
  compra_producto_nombre: string | null;
  compra_pres_producto_nombre: string | null;
  compra_pres_volumen: string | null;
  compra_pres_producto_id: string | null;
  regalo_producto_nombre: string | null;
  regalo_pres_producto_nombre: string | null;
  regalo_pres_volumen: string | null;
};

function aPromocion(f: FilaPromocion): Omit<Promocion, 'texto'> {
  const compraNombre =
    f.compra_tipo === 'producto'
      ? f.compra_producto_nombre
      : f.compra_tipo === 'presentacion'
        ? `${f.compra_pres_producto_nombre ?? ''} ${f.compra_pres_volumen ?? ''}`.trim()
        : null;
  const regaloNombre =
    f.regalo_tipo === 'producto'
      ? f.regalo_producto_nombre
      : f.regalo_tipo === 'presentacion'
        ? `${f.regalo_pres_producto_nombre ?? ''} ${f.regalo_pres_volumen ?? ''}`.trim()
        : null;
  return {
    id: f.id,
    sucursalId: f.sucursal_id,
    sucursalCodigo: f.sucursal_codigo,
    activo: f.activo,
    audiencia: f.audiencia as AudienciaPromocion,
    clienteId: f.cliente_id,
    clienteNombre: f.cliente_nombre,
    compraTipo: f.compra_tipo as CompraPromocion,
    compraProductoId: f.compra_producto_id,
    compraPresentacionId: f.compra_presentacion_id,
    compraCantidad: f.compra_cantidad,
    regaloTipo: f.regalo_tipo as RegaloPromocion,
    regaloProductoId: f.regalo_producto_id,
    regaloPresentacionId: f.regalo_presentacion_id,
    regaloCantidad: f.regalo_cantidad,
    seRepite: f.se_repite,
    compraNombre,
    regaloNombre,
    compraProductoCubierto:
      f.compra_tipo === 'producto'
        ? f.compra_producto_id
        : f.compra_tipo === 'presentacion'
          ? f.compra_pres_producto_id
          : null,
  };
}

@Injectable()
export class PromocionesRepository {
  constructor(@Inject(DB_CONNECTION) private readonly db: Database) {}

  /**
   * La consulta base con los cuatro joins de nombres. Los `leftJoin` con alias
   * son necesarios porque compra y regalo pueden apuntar a productos y
   * presentaciones distintos.
   */
  private base(trx?: Transaction<DB>) {
    return (trx ?? this.db)
      .selectFrom('promocion as p')
      .innerJoin('sucursal as s', 's.id', 'p.sucursal_id')
      .leftJoin('cliente as c', 'c.id', 'p.cliente_id')
      .leftJoin('producto as cp', 'cp.id', 'p.compra_producto_id')
      .leftJoin('presentacion as cpr', 'cpr.id', 'p.compra_presentacion_id')
      .leftJoin('producto as cprp', 'cprp.id', 'cpr.producto_id')
      .leftJoin('producto as rp', 'rp.id', 'p.regalo_producto_id')
      .leftJoin('presentacion as rpr', 'rpr.id', 'p.regalo_presentacion_id')
      .leftJoin('producto as rprp', 'rprp.id', 'rpr.producto_id')
      .select([
        'p.id',
        'p.sucursal_id',
        's.codigo as sucursal_codigo',
        'p.activo',
        'p.audiencia',
        'p.cliente_id',
        'c.nombre as cliente_nombre',
        'p.compra_tipo',
        'p.compra_producto_id',
        'p.compra_presentacion_id',
        'p.compra_cantidad',
        'p.regalo_tipo',
        'p.regalo_producto_id',
        'p.regalo_presentacion_id',
        'p.regalo_cantidad',
        'p.se_repite',
        'cp.nombre as compra_producto_nombre',
        'cprp.nombre as compra_pres_producto_nombre',
        'cpr.volumen as compra_pres_volumen',
        'cpr.producto_id as compra_pres_producto_id',
        'rp.nombre as regalo_producto_nombre',
        'rprp.nombre as regalo_pres_producto_nombre',
        'rpr.volumen as regalo_pres_volumen',
      ])
      .where('p.deleted_at', 'is', null);
  }

  /** Las de `todos` y `prospecto` de una sucursal (activas e inactivas: la pantalla reactiva). */
  async generales(sucursalId: string): Promise<Omit<Promocion, 'texto'>[]> {
    const filas = await this.base()
      .where('p.sucursal_id', '=', sucursalId)
      .where('p.audiencia', 'in', ['todos', 'prospecto'])
      .orderBy('p.audiencia')
      .orderBy('p.created_at')
      .execute();
    return filas.map((f) => aPromocion(f));
  }

  /**
   * Las propias del cliente mas las de `todos` de su sucursal; con
   * `incluirProspecto` (un prospecto sin primera venta, D7), tambien las de
   * `prospecto` de su sucursal.
   */
  async deCliente(
    clienteId: string,
    sucursalId: string,
    incluirProspecto: boolean,
  ): Promise<Omit<Promocion, 'texto'>[]> {
    const audiencias = incluirProspecto ? ['todos', 'prospecto'] : ['todos'];
    const filas = await this.base()
      .where((eb) =>
        eb.or([
          eb('p.cliente_id', '=', clienteId),
          eb.and([
            eb('p.sucursal_id', '=', sucursalId),
            eb('p.audiencia', 'in', audiencias),
          ]),
        ]),
      )
      .orderBy('p.audiencia')
      .orderBy('p.created_at')
      .execute();
    return filas.map((f) => aPromocion(f));
  }

  /** Con `trx`, lee dentro de la transaccion (ve lo recien escrito, aun sin confirmar). */
  async buscar(
    id: string,
    trx?: Transaction<DB>,
  ): Promise<Omit<Promocion, 'texto'> | undefined> {
    const fila = await this.base(trx).where('p.id', '=', id).executeTakeFirst();
    return fila ? aPromocion(fila) : undefined;
  }

  async crear(
    filas: NuevaPromocion[],
    trx?: Transaction<DB>,
  ): Promise<string[]> {
    const q = (trx ?? this.db)
      .insertInto('promocion')
      .values(
        filas.map((n) => ({
          sucursal_id: n.sucursalId,
          audiencia: n.audiencia,
          cliente_id: n.clienteId,
          compra_tipo: n.compraTipo,
          compra_producto_id: n.compraProductoId,
          compra_presentacion_id: n.compraPresentacionId,
          compra_cantidad: n.compraCantidad,
          regalo_tipo: n.regaloTipo,
          regalo_producto_id: n.regaloProductoId,
          regalo_presentacion_id: n.regaloPresentacionId,
          regalo_cantidad: n.regaloCantidad,
          se_repite: n.seRepite,
        })),
      )
      .returning('id');
    return (await q.execute()).map((f) => f.id);
  }

  async actualizar(
    id: string,
    cambios: Omit<ReglaCompleta, 'audiencia' | 'clienteId'> & {
      activo: boolean;
    },
    trx?: Transaction<DB>,
  ): Promise<void> {
    await (trx ?? this.db)
      .updateTable('promocion')
      .set({
        compra_tipo: cambios.compraTipo,
        compra_producto_id: cambios.compraProductoId,
        compra_presentacion_id: cambios.compraPresentacionId,
        compra_cantidad: cambios.compraCantidad,
        regalo_tipo: cambios.regaloTipo,
        regalo_producto_id: cambios.regaloProductoId,
        regalo_presentacion_id: cambios.regaloPresentacionId,
        regalo_cantidad: cambios.regaloCantidad,
        se_repite: cambios.seRepite,
        activo: cambios.activo,
      })
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .execute();
  }

  /**
   * El cliente, si vive: su sucursal (id y codigo) para el alcance y la fila,
   * y si es un prospecto sin primera venta (D7) para saber si le toca la bienvenida.
   */
  async clienteVivo(id: string): Promise<
    | {
        id: string;
        sucursalId: string;
        sucursalCodigo: string;
        prospectoSinVenta: boolean;
      }
    | undefined
  > {
    const f = await this.db
      .selectFrom('cliente')
      .innerJoin('sucursal', 'sucursal.id', 'cliente.sucursal_id')
      .select([
        'cliente.id',
        'cliente.sucursal_id',
        'sucursal.codigo',
        'cliente.tipo',
        'cliente.primera_venta_en',
      ])
      .where('cliente.id', '=', id)
      .where('cliente.deleted_at', 'is', null)
      .executeTakeFirst();
    return f
      ? {
          id: f.id,
          sucursalId: f.sucursal_id,
          sucursalCodigo: f.codigo,
          prospectoSinVenta:
            f.tipo === 'prospecto' && f.primera_venta_en === null,
        }
      : undefined;
  }

  async productoVivo(id: string): Promise<boolean> {
    const f = await this.db
      .selectFrom('producto')
      .select('id')
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    return f !== undefined;
  }

  async presentacionViva(id: string): Promise<boolean> {
    const f = await this.db
      .selectFrom('presentacion')
      .select('id')
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    return f !== undefined;
  }

  /** Sucursales activas, todas o una por codigo. */
  async sucursalesActivas(
    codigo: string | null,
  ): Promise<{ id: string; codigo: string }[]> {
    let q = this.db
      .selectFrom('sucursal')
      .select(['id', 'codigo'])
      .where('activa', '=', true)
      .where('deleted_at', 'is', null);
    if (codigo !== null) q = q.where('codigo', '=', codigo);
    return q.orderBy('codigo').execute();
  }

  buscarSucursalUsuario(usuarioId: string) {
    return buscarSucursalUsuarioCompartido(this.db, usuarioId);
  }

  enTransaccion<T>(tarea: (trx: Transaction<DB>) => Promise<T>): Promise<T> {
    return this.db.transaction().execute(tarea);
  }
}
