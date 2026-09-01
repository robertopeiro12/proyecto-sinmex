import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DB_CONNECTION, type Database } from '../../database/database.tokens';
import { buscarSucursalUsuario } from '../sucursales/buscar-sucursal-usuario';
import { aNumero } from '../sincronizacion/dinero';
import type { PlanPromocionProductos } from './reconciliar-promocion-productos';

export type TipoCliente = 'cliente' | 'prospecto';
export type TipoFiltro = TipoCliente | 'todos';
export type Promocion = 'ninguna' | '10+1' | '20+1';

export interface ClienteResumen {
  id: string;
  nombre: string;
  telefono: string;
  tipo: TipoCliente;
  tipoNegocio: string | null;
  sucursalCodigo: string;
}

export interface OverridePrecio {
  presentacionId: string;
  precio: number;
  vigenteDesde: string;
}

export interface ClienteDetalle {
  id: string;
  nombre: string;
  domicilio: string;
  telefono: string;
  encargado: string | null;
  factura: boolean;
  tipo: TipoCliente;
  tipoNegocioId: string | null;
  listaPrecioId: string;
  pctComision: number | null;
  promocion: Promocion;
  plazoCreditoDias: number | null;
  lat: number | null;
  lng: number | null;
  comentarios: string | null;
  sucursalId: string;
  sucursalCodigo: string;
  overridesPrecio: OverridePrecio[];
  productosPromocion: string[];
}

/** Los campos de `cliente` que escriben `crear()`/`actualizar()`, en snake_case (columnas). */
export interface DatosClienteBase {
  nombre: string;
  domicilio: string;
  telefono: string;
  encargado: string | null;
  factura: boolean;
  tipo_negocio_id: string | null;
  lista_precio_id: string;
  pct_comision: number | null;
  promocion: Promocion;
  plazo_credito_dias: number | null;
  lat: number | null;
  lng: number | null;
  comentarios: string | null;
}

interface FilaResumen {
  id: string;
  nombre: string;
  telefono: string;
  tipo: string;
  tipo_negocio_nombre: string | null;
  codigo: string;
}

function aResumen(fila: FilaResumen): ClienteResumen {
  return {
    id: fila.id,
    nombre: fila.nombre,
    telefono: fila.telefono,
    tipo: fila.tipo as TipoCliente,
    tipoNegocio: fila.tipo_negocio_nombre,
    sucursalCodigo: fila.codigo,
  };
}

interface FilaDetalle {
  id: string;
  nombre: string;
  domicilio: string;
  telefono: string;
  encargado: string | null;
  factura: boolean;
  tipo: string;
  tipo_negocio_id: string | null;
  lista_precio_id: string;
  pct_comision: string | null;
  promocion: string;
  plazo_credito_dias: number | null;
  lat: string | null;
  lng: string | null;
  comentarios: string | null;
  sucursal_id: string;
  codigo: string;
}

interface FilaOverride {
  presentacion_id: string;
  precio: string;
  vigente_desde: string;
}

function aDetalle(
  fila: FilaDetalle,
  overrides: FilaOverride[],
  productosPromocion: string[],
): ClienteDetalle {
  return {
    id: fila.id,
    nombre: fila.nombre,
    domicilio: fila.domicilio,
    telefono: fila.telefono,
    encargado: fila.encargado,
    factura: fila.factura,
    tipo: fila.tipo as TipoCliente,
    tipoNegocioId: fila.tipo_negocio_id,
    listaPrecioId: fila.lista_precio_id,
    pctComision: aNumero(fila.pct_comision),
    promocion: fila.promocion as Promocion,
    plazoCreditoDias: fila.plazo_credito_dias,
    lat: aNumero(fila.lat),
    lng: aNumero(fila.lng),
    comentarios: fila.comentarios,
    sucursalId: fila.sucursal_id,
    sucursalCodigo: fila.codigo,
    overridesPrecio: overrides.map((o) => ({
      presentacionId: o.presentacion_id,
      precio: aNumero(o.precio) ?? 0,
      vigenteDesde: o.vigente_desde,
    })),
    productosPromocion,
  };
}

const COLUMNAS_RESUMEN = [
  'cliente.id',
  'cliente.nombre',
  'cliente.telefono',
  'cliente.tipo',
  'tipo_negocio.nombre as tipo_negocio_nombre',
  'sucursal.codigo',
] as const;

const COLUMNAS_DETALLE = [
  'cliente.id',
  'cliente.nombre',
  'cliente.domicilio',
  'cliente.telefono',
  'cliente.encargado',
  'cliente.factura',
  'cliente.tipo',
  'cliente.tipo_negocio_id',
  'cliente.lista_precio_id',
  'cliente.pct_comision',
  'cliente.promocion',
  'cliente.plazo_credito_dias',
  'cliente.lat',
  'cliente.lng',
  'cliente.comentarios',
  'cliente.sucursal_id',
  'sucursal.codigo',
] as const;

@Injectable()
export class ClientesRepository {
  constructor(@Inject(DB_CONNECTION) private readonly db: Database) {}

  async listar(tipo: TipoFiltro): Promise<ClienteResumen[]> {
    let query = this.db
      .selectFrom('cliente')
      .innerJoin('sucursal', 'sucursal.id', 'cliente.sucursal_id')
      .leftJoin('tipo_negocio', 'tipo_negocio.id', 'cliente.tipo_negocio_id')
      .select(COLUMNAS_RESUMEN)
      .where('cliente.deleted_at', 'is', null);
    if (tipo !== 'todos') {
      query = query.where('cliente.tipo', '=', tipo);
    }
    const filas = await query
      .orderBy('sucursal.codigo')
      .orderBy('cliente.nombre')
      .execute();
    return filas.map(aResumen);
  }

  async listarPorCodigoSucursal(
    codigo: string,
    tipo: TipoFiltro,
  ): Promise<ClienteResumen[]> {
    let query = this.db
      .selectFrom('cliente')
      .innerJoin('sucursal', 'sucursal.id', 'cliente.sucursal_id')
      .leftJoin('tipo_negocio', 'tipo_negocio.id', 'cliente.tipo_negocio_id')
      .select(COLUMNAS_RESUMEN)
      .where('cliente.deleted_at', 'is', null)
      .where('sucursal.codigo', '=', codigo);
    if (tipo !== 'todos') {
      query = query.where('cliente.tipo', '=', tipo);
    }
    const filas = await query.orderBy('cliente.nombre').execute();
    return filas.map(aResumen);
  }

  /**
   * El detalle completo: campos base + overrides VIGENTES (mismo `DISTINCT
   * ON` que `PreciosRepository.listarVigentes` de T-18, sin `sucursal_id`
   * porque el cliente ya pertenece a una sola) + productos de promocion.
   * Tres consultas en vez de un solo `LEFT JOIN` gigante: los overrides y la
   * promocion son colecciones (0..N filas), y mezclarlas con la fila de
   * `cliente` en un solo `SELECT` obligaria a deduplicar en memoria.
   */
  async obtener(id: string): Promise<ClienteDetalle | undefined> {
    const fila = await this.db
      .selectFrom('cliente')
      .innerJoin('sucursal', 'sucursal.id', 'cliente.sucursal_id')
      .select(COLUMNAS_DETALLE)
      .where('cliente.id', '=', id)
      .where('cliente.deleted_at', 'is', null)
      .executeTakeFirst();

    if (!fila) return undefined;

    const overrides = await sql<FilaOverride>`
      select distinct on (presentacion_id)
        presentacion_id, precio, vigente_desde::text as vigente_desde
      from cliente_precio
      where cliente_id = ${id}
        and deleted_at is null
        and vigente_desde <= current_date
      order by presentacion_id, vigente_desde desc
    `.execute(this.db);

    const productos = await this.db
      .selectFrom('cliente_promocion_producto')
      .select('producto_id')
      .where('cliente_id', '=', id)
      .where('deleted_at', 'is', null)
      .execute();

    return aDetalle(
      fila,
      overrides.rows,
      productos.map((p) => p.producto_id),
    );
  }

  /**
   * Alta: cliente, productos de promocion y overrides de precio en una sola
   * transaccion (D4 del spec) -- mismo criterio que
   * `ProductosRepository.crear` de T-10 (producto + presentaciones juntos).
   * `cliente_id` es nuevo en esta transaccion, asi que ni el unique de
   * `cliente_promocion_producto` ni `uq_cliente_precio_vigencia` pueden
   * chocar todavia: a diferencia de `actualizar()` (Task 7), aqui no hace
   * falta `on conflict`.
   */
  async crear(
    datos: DatosClienteBase & { tipo: TipoCliente; sucursal_id: string },
    productosPromocion: string[],
    overridesPrecio: { presentacionId: string; precio: number }[],
    vigenteDesde: string,
  ): Promise<ClienteDetalle> {
    const id = await this.db.transaction().execute(async (trx) => {
      const cliente = await trx
        .insertInto('cliente')
        .values({
          nombre: datos.nombre,
          domicilio: datos.domicilio,
          telefono: datos.telefono,
          encargado: datos.encargado,
          factura: datos.factura,
          tipo: datos.tipo,
          tipo_negocio_id: datos.tipo_negocio_id,
          lista_precio_id: datos.lista_precio_id,
          pct_comision: datos.pct_comision?.toString() ?? null,
          promocion: datos.promocion,
          plazo_credito_dias: datos.plazo_credito_dias,
          lat: datos.lat?.toString() ?? null,
          lng: datos.lng?.toString() ?? null,
          comentarios: datos.comentarios,
          sucursal_id: datos.sucursal_id,
        })
        .returning('id')
        .executeTakeFirstOrThrow();

      if (productosPromocion.length > 0) {
        await trx
          .insertInto('cliente_promocion_producto')
          .values(
            productosPromocion.map((producto_id) => ({
              cliente_id: cliente.id,
              producto_id,
            })),
          )
          .execute();
      }

      if (overridesPrecio.length > 0) {
        await trx
          .insertInto('cliente_precio')
          .values(
            overridesPrecio.map((o) => ({
              cliente_id: cliente.id,
              presentacion_id: o.presentacionId,
              precio: o.precio.toString(),
              vigente_desde: vigenteDesde,
            })),
          )
          .execute();
      }

      return cliente.id;
    });

    // Fuera de la transaccion: `obtener()` ya sabe leer overrides+promocion,
    // y reusarlo evita duplicar esa lectura dentro de la transaccion.
    return (await this.obtener(id))!;
  }

  /**
   * Edición: datos base + productos de promocion + overrides, todo en una
   * transaccion. A diferencia de `crear()`, aqui SI puede haber conflicto
   * (el cliente ya existe), asi que las dos colecciones usan `on conflict`
   * en vez de un `insert` liso.
   */
  async actualizar(
    id: string,
    cambios: DatosClienteBase,
    planPromocion: PlanPromocionProductos,
    overridesPrecio: { presentacionId: string; precio: number | null }[],
    vigenteDesde: string,
  ): Promise<ClienteDetalle> {
    await this.db.transaction().execute(async (trx) => {
      await trx
        .updateTable('cliente')
        .set({
          nombre: cambios.nombre,
          domicilio: cambios.domicilio,
          telefono: cambios.telefono,
          encargado: cambios.encargado,
          factura: cambios.factura,
          tipo_negocio_id: cambios.tipo_negocio_id,
          lista_precio_id: cambios.lista_precio_id,
          pct_comision: cambios.pct_comision?.toString() ?? null,
          promocion: cambios.promocion,
          plazo_credito_dias: cambios.plazo_credito_dias,
          lat: cambios.lat?.toString() ?? null,
          lng: cambios.lng?.toString() ?? null,
          comentarios: cambios.comentarios,
        })
        .where('id', '=', id)
        .executeTakeFirstOrThrow();

      if (planPromocion.eliminar.length > 0) {
        await trx
          .updateTable('cliente_promocion_producto')
          .set({ deleted_at: new Date() })
          .where('cliente_id', '=', id)
          .where('producto_id', 'in', planPromocion.eliminar)
          .execute();
      }

      if (planPromocion.insertar.length > 0) {
        // El unique (cliente_id, producto_id) de T-05 NO excluye
        // `deleted_at` (a diferencia de uq_vehiculo_nombre_sucursal de
        // T-11): una fila dada de baja sigue ocupando la combinacion. Un
        // `insert` liso chocaria con 23505 al volver a agregar un producto
        // que antes se habia quitado de la promocion -- revivir la fila con
        // `on conflict ... do update` es obligatorio, no una optimizacion.
        await trx
          .insertInto('cliente_promocion_producto')
          .values(
            planPromocion.insertar.map((producto_id) => ({
              cliente_id: id,
              producto_id,
            })),
          )
          .onConflict((oc) =>
            oc
              .columns(['cliente_id', 'producto_id'])
              .doUpdateSet({ deleted_at: null }),
          )
          .execute();
      }

      for (const override of overridesPrecio) {
        if (override.precio === null) {
          // Da de baja TODAS las filas activas de este par (cliente,
          // presentacion), no solo la de HOY: `vigenteDesde` en todo este
          // sistema es siempre "hoy" (el formulario no ofrece programar un
          // cambio a futuro), asi que nunca deberia haber mas de una fila
          // simultaneamente activa para el mismo par. Si el override se
          // guardo en un dia anterior, esa fila vieja sigue con
          // `deleted_at is null` y `obtener()` (que lee
          // `vigente_desde <= current_date`) la volveria a mostrar aunque el
          // usuario acabe de "quitarla" -- limpiar solo la fila de hoy dejaba
          // ese caso sin forma de borrarse desde la UI.
          await trx
            .updateTable('cliente_precio')
            .set({ deleted_at: new Date() })
            .where('cliente_id', '=', id)
            .where('presentacion_id', '=', override.presentacionId)
            .where('deleted_at', 'is', null)
            .execute();
          continue;
        }

        await trx
          .insertInto('cliente_precio')
          .values({
            cliente_id: id,
            presentacion_id: override.presentacionId,
            precio: override.precio.toString(),
            vigente_desde: vigenteDesde,
          })
          .onConflict((oc) =>
            oc.constraint('uq_cliente_precio_vigencia').doUpdateSet({
              precio: (override.precio as number).toString(),
              // uq_cliente_precio_vigencia (a diferencia de
              // uq_vehiculo_nombre_sucursal de T-11) tampoco excluye
              // `deleted_at`: la fila de HOY que el bloque de arriba
              // acaba de dar de baja sigue ocupando (cliente_id,
              // presentacion_id, vigente_desde). Sin resetear
              // `deleted_at` aqui, un alta-baja-alta el mismo dia deja el
              // precio nuevo invisible para `obtener()` aunque el PATCH
              // responda 200 -- mismo gotcha que la revivida de
              // cliente_promocion_producto un poco mas arriba.
              deleted_at: null,
            }),
          )
          .execute();
      }
    });

    return (await this.obtener(id))!;
  }

  async eliminar(id: string): Promise<void> {
    await this.db
      .updateTable('cliente')
      .set({ deleted_at: new Date() })
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
  }

  /**
   * Un solo sentido (Prospecto -> Cliente, nunca al reves): el servicio ya
   * verifico que el cliente existe y que `tipo` sigue siendo 'prospecto'
   * antes de llamar aqui, asi que esto es un `UPDATE` liso, sin condicion.
   */
  async convertirACliente(id: string): Promise<ClienteDetalle> {
    await this.db
      .updateTable('cliente')
      .set({ tipo: 'cliente' })
      .where('id', '=', id)
      .executeTakeFirstOrThrow();

    return (await this.obtener(id))!;
  }

  /** Delegado al helper compartido (D9 del plan, Task 2). */
  async buscarSucursalUsuario(
    usuarioId: string,
  ): Promise<{ id: string | null; codigo: string | null } | undefined> {
    return buscarSucursalUsuario(this.db, usuarioId);
  }
}
