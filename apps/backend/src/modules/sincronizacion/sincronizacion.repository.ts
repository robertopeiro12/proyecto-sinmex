import { Inject, Injectable } from '@nestjs/common';
import { sql, type Transaction } from 'kysely';
import { DB_CONNECTION, type Database } from '../../database/database.tokens';
import type { DB } from '../../database/schema';
import type {
  ClientePull,
  MetodoPagoAbono,
  NotaPendientePull,
  PrecioPull,
  PresentacionPull,
  ProductoPull,
  PromocionPull,
  RutaPull,
  SucursalPull,
  TipoNegocioPull,
  MotivoVisitaPull,
  CampoEgresoPull,
  VehiculoPull,
  VendedorPull,
} from './contrato';
import { aCentavos, aNumero } from './dinero';
import type { OperacionNormalizada } from './operaciones';

/** El vendedor autenticado con su sucursal ya resuelta. */
export interface VendedorConSucursal {
  id: string;
  login: string;
  nombre: string;
  activo: boolean;
  /** Su 5o segmento del [[Folios|folio]]. `null` si no tiene uno asignado. */
  folio_segmento: string | null;
  sucursal_id: string;
  sucursal_codigo: string;
  sucursal_nombre: string;
}

/**
 * `activo: 0` para lo dado de baja o desactivado.
 *
 * La baja **viaja como bandera**, no como ausencia: la tablet aplica upsert y
 * una fila que desapareciera del snapshot se quedaria ahi para siempre. Ver el
 * comentario de `FilaSincronizable` en `contrato.ts`.
 */
function bandera(activo: boolean, borrado: Date | string | null): 0 | 1 {
  return activo && borrado === null ? 1 : 0;
}

@Injectable()
export class SincronizacionRepository {
  constructor(@Inject(DB_CONNECTION) private readonly db: Database) {}

  /** El reloj del servidor, que es el que manda para el cursor del pull. */
  async ahora(): Promise<Date> {
    const fila = await sql<{ ahora: Date }>`select now() as ahora`.execute(
      this.db,
    );
    return fila.rows[0].ahora;
  }

  async buscarVendedor(id: string): Promise<VendedorConSucursal | undefined> {
    return this.db
      .selectFrom('vendedor')
      .innerJoin('sucursal', 'sucursal.id', 'vendedor.sucursal_id')
      .select([
        'vendedor.id as id',
        'vendedor.login as login',
        'vendedor.nombre as nombre',
        'vendedor.activo as activo',
        'vendedor.folio_segmento as folio_segmento',
        'sucursal.id as sucursal_id',
        'sucursal.codigo as sucursal_codigo',
        'sucursal.nombre as sucursal_nombre',
      ])
      .where('vendedor.id', '=', id)
      .where('vendedor.deleted_at', 'is', null)
      .executeTakeFirst();
  }

  /* ---------------------------------------------------------------- */
  /* Pull                                                              */
  /* ---------------------------------------------------------------- */

  /**
   * La sucursal del vendedor. Se manda **solo la suya**: la tablet no necesita
   * el catalogo de sucursales, necesita la fila a la que apunta su jornada.
   */
  async sucursales(
    sucursalId: string,
    desde: Date | null,
  ): Promise<SucursalPull[]> {
    let q = this.db
      .selectFrom('sucursal')
      .select(['id', 'codigo', 'nombre', 'activa', 'deleted_at'])
      .where('id', '=', sucursalId);
    if (desde) q = q.where('updated_at', '>', desde);

    return (await q.execute()).map((f) => ({
      id: f.id,
      codigo: f.codigo,
      nombre: f.nombre,
      activo: bandera(f.activa, f.deleted_at),
    }));
  }

  /**
   * **Solo el vendedor autenticado.**
   *
   * Mandar el resto de vendedores de la sucursal seria comodo (la tablet tiene
   * la tabla) pero es exactamente lo que la restriccion de alcance de T-09
   * prohibe: un vendedor solo jala lo suyo. Su fila hace falta porque `jornada`
   * tiene llave foranea a `vendedor`.
   */
  async vendedores(
    vendedorId: string,
    desde: Date | null,
  ): Promise<VendedorPull[]> {
    let q = this.db
      .selectFrom('vendedor')
      .innerJoin('sucursal', 'sucursal.id', 'vendedor.sucursal_id')
      .select([
        'vendedor.id as id',
        'vendedor.login as login',
        'vendedor.nombre as nombre',
        'vendedor.sucursal_id as sucursal_id',
        'vendedor.activo as activo',
        'vendedor.folio_segmento as folio_segmento',
        'vendedor.deleted_at as deleted_at',
        // T-27 (D7): la casilla es de la sucursal; cambiarla toca
        // `vendedor.updated_at` (SucursalesRepository.actualizar), asi que el
        // corte incremental de abajo la trae.
        'sucursal.control_inventario as control_inventario',
      ])
      .where('vendedor.id', '=', vendedorId);
    if (desde) q = q.where('vendedor.updated_at', '>', desde);

    return (await q.execute()).map((f) => ({
      id: f.id,
      login: f.login,
      nombre: f.nombre,
      sucursal_id: f.sucursal_id,
      // Lo asigna el servidor porque la tablet no puede: solo baja su propia
      // ficha, asi que no ve si otro vendedor comparte sus iniciales (T-14).
      folio_segmento: f.folio_segmento,
      control_inventario: f.control_inventario,
      activo: bandera(f.activo, f.deleted_at),
    }));
  }

  async vehiculos(
    sucursalId: string,
    desde: Date | null,
  ): Promise<VehiculoPull[]> {
    let q = this.db
      .selectFrom('vehiculo')
      .select(['id', 'nombre', 'sucursal_id', 'activo', 'deleted_at'])
      .where('sucursal_id', '=', sucursalId);
    if (desde) q = q.where('updated_at', '>', desde);

    return (await q.orderBy('nombre').execute()).map((f) => ({
      id: f.id,
      nombre: f.nombre,
      sucursal_id: f.sucursal_id,
      activo: bandera(f.activo, f.deleted_at),
    }));
  }

  /** Los productos no cuelgan de una sucursal: el catalogo es de la empresa. */
  async productos(desde: Date | null): Promise<ProductoPull[]> {
    let q = this.db
      .selectFrom('producto')
      .select(['id', 'nombre', 'activo', 'deleted_at']);
    if (desde) q = q.where('updated_at', '>', desde);

    return (await q.orderBy('nombre').execute()).map((f) => ({
      id: f.id,
      nombre: f.nombre,
      activo: bandera(f.activo, f.deleted_at),
    }));
  }

  /**
   * Los tipos de negocio tampoco cuelgan de una sucursal (T-40): el giro es un
   * catalogo de la empresa, igual que los productos.
   *
   * `tipo_negocio` no tiene columna `activo`: su unica baja es `deleted_at`,
   * igual que `presentacion`.
   */
  async tiposNegocio(desde: Date | null): Promise<TipoNegocioPull[]> {
    let q = this.db
      .selectFrom('tipo_negocio')
      .select(['id', 'nombre', 'deleted_at']);
    if (desde) q = q.where('updated_at', '>', desde);

    return (await q.orderBy('nombre').execute()).map((f) => ({
      id: f.id,
      nombre: f.nombre,
      activo: bandera(true, f.deleted_at),
    }));
  }

  /**
   * Motivos de visita (T-39, D4): catalogo global, como los tipos de negocio.
   *
   * Corta por `actualizado_en` y no por `updated_at`: el spec de T-39 nombra asi
   * las columnas de tiempo, y el trigger `set_actualizado_en` la mueve en
   * cualquier update (la baja logica incluida). Sin `desde` bajan todas, las
   * dadas de baja con `activo: 0`, igual que `tipos_negocio`.
   */
  async motivosVisita(desde: Date | null): Promise<MotivoVisitaPull[]> {
    let q = this.db
      .selectFrom('motivo_visita')
      .select(['id', 'nombre', 'exige_foto', 'exige_atendio', 'deleted_at']);
    if (desde) q = q.where('actualizado_en', '>', desde);

    return (await q.orderBy('nombre').execute()).map((f) => ({
      id: f.id,
      nombre: f.nombre,
      exige_foto: f.exige_foto,
      exige_atendio: f.exige_atendio,
      activo: bandera(true, f.deleted_at),
    }));
  }

  /** T-30 (D6): el catalogo de la pantalla de gastos. Global, como los motivos. */
  async camposEgreso(desde: Date | null): Promise<CampoEgresoPull[]> {
    let q = this.db
      .selectFrom('campo_egreso')
      .select(['id', 'nombre', 'tipo', 'se_usa_en_app', 'deleted_at']);
    if (desde) q = q.where('actualizado_en', '>', desde);

    return (await q.orderBy('nombre').execute()).map((f) => ({
      id: f.id,
      nombre: f.nombre,
      // El check `ck_campo_egreso_tipo` garantiza uno de los tres.
      tipo: f.tipo as CampoEgresoPull['tipo'],
      se_usa_en_app: f.se_usa_en_app,
      activo: bandera(true, f.deleted_at),
    }));
  }

  async presentaciones(desde: Date | null): Promise<PresentacionPull[]> {
    let q = this.db
      .selectFrom('presentacion')
      .select(['id', 'producto_id', 'volumen', 'deleted_at']);
    if (desde) q = q.where('updated_at', '>', desde);

    // `presentacion` no tiene columna `activo`: su unica baja es `deleted_at`.
    return (await q.orderBy('volumen').execute()).map((f) => ({
      id: f.id,
      producto_id: f.producto_id,
      volumen: f.volumen,
      activo: bandera(true, f.deleted_at),
    }));
  }

  async clientes(
    sucursalId: string,
    desde: Date | null,
  ): Promise<ClientePull[]> {
    let q = this.db
      .selectFrom('cliente')
      .select([
        'id',
        'nombre',
        'domicilio',
        'telefono',
        'encargado',
        'tipo',
        'pct_comision',
        'primera_venta_en',
        'plazo_credito_dias',
        'lat',
        'lng',
        'ubicacion_origen',
        'sucursal_id',
        'foto_subida_en',
        'deleted_at',
      ])
      // T-20 (D5): el saldo a favor es la suma de los movimientos vivos. Con
      // `desde`, un cliente vuelve a bajar porque `registrarCobranza` le toca
      // `updated_at` al crearle un movimiento.
      .select((eb) =>
        eb
          .selectFrom('saldo_favor_movimiento as sf')
          .select(sql<string>`coalesce(sum(sf.monto), 0)::text`.as('total'))
          .whereRef('sf.cliente_id', '=', 'cliente.id')
          .where('sf.deleted_at', 'is', null)
          .as('saldo_favor'),
      )
      .where('sucursal_id', '=', sucursalId);
    if (desde) q = q.where('updated_at', '>', desde);

    return (await q.orderBy('nombre').execute()).map((f) => ({
      id: f.id,
      nombre: f.nombre,
      domicilio: f.domicilio,
      telefono: f.telefono,
      encargado: f.encargado,
      tipo: f.tipo as 'cliente' | 'prospecto',
      // numeric -> numero: es un porcentaje, no dinero.
      pct_comision: aNumero(f.pct_comision),
      primera_venta_en: f.primera_venta_en
        ? new Date(f.primera_venta_en).toISOString()
        : null,
      plazo_credito_dias: f.plazo_credito_dias,
      lat: aNumero(f.lat),
      lng: aNumero(f.lng),
      // T-72 (D3): de donde salio la coordenada. La tablet la guarda.
      ubicacion_origen: f.ubicacion_origen as ClientePull['ubicacion_origen'],
      sucursal_id: f.sucursal_id,
      saldo_favor_centavos: aCentavos(f.saldo_favor),
      // T-39 (D9): la ficha de la tablet decide con esto si baja la foto.
      foto_subida_en: f.foto_subida_en
        ? new Date(f.foto_subida_en).toISOString()
        : null,
      activo: bandera(true, f.deleted_at),
    }));
  }

  /**
   * ¿Se movio algo que afecte a los precios de esta sucursal desde `desde`?
   *
   * Son tres tablas: la lista de precios (`precio`), el override por cliente
   * (`cliente_precio`) y el propio `cliente` (que es quien dice a que lista
   * pertenece). Cambiar cualquiera cambia el precio efectivo, asi que un cursor
   * por fila sobre el resultado del join se perderia cambios.
   */
  async preciosCambiaron(sucursalId: string, desde: Date): Promise<boolean> {
    const fila = await sql<{ cambio: boolean }>`
      select exists (
        select 1 from precio
          where sucursal_id = ${sucursalId} and updated_at > ${desde}
        union all
        select 1 from cliente_precio cp
          join cliente c on c.id = cp.cliente_id
          where c.sucursal_id = ${sucursalId} and cp.updated_at > ${desde}
        union all
        select 1 from cliente
          where sucursal_id = ${sucursalId} and updated_at > ${desde}
      ) as cambio
    `.execute(this.db);
    return fila.rows[0].cambio;
  }

  /**
   * Precio **ya resuelto** por cliente y presentacion, vigente en `fecha`.
   *
   * Implementa la formula de [[Lista de precios]] tal cual esta escrita:
   * el precio sale de la lista del cliente para su sucursal, salvo que exista
   * un override para ese cliente. En ambos casos se toma el registro vigente
   * mas reciente que no sea futuro (historizacion "de la fecha en adelante").
   *
   * El `id` es sintetico (`clienteId:presentacionId`): la fila de origen puede
   * ser de `precio` —compartida por todos los clientes de esa lista— y usar su
   * id colisionaria en la llave primaria de la tablet.
   */
  async precios(sucursalId: string, fecha: string): Promise<PrecioPull[]> {
    const filas = await sql<{
      cliente_id: string;
      presentacion_id: string;
      precio: string;
      vigente_desde: Date;
    }>`
      with vigente_lista as (
        select distinct on (presentacion_id, lista_precio_id)
               presentacion_id, lista_precio_id, precio, vigente_desde
          from precio
         where sucursal_id = ${sucursalId}
           and deleted_at is null
           and vigente_desde <= ${fecha}::date
         order by presentacion_id, lista_precio_id, vigente_desde desc
      ),
      vigente_cliente as (
        select distinct on (cliente_id, presentacion_id)
               cliente_id, presentacion_id, precio, vigente_desde
          from cliente_precio
         where deleted_at is null
           and vigente_desde <= ${fecha}::date
         order by cliente_id, presentacion_id, vigente_desde desc
      )
      select c.id as cliente_id,
             coalesce(vc.presentacion_id, vl.presentacion_id) as presentacion_id,
             coalesce(vc.precio, vl.precio) as precio,
             coalesce(vc.vigente_desde, vl.vigente_desde) as vigente_desde
        from cliente c
        left join vigente_lista vl on vl.lista_precio_id = c.lista_precio_id
        left join vigente_cliente vc
               on vc.cliente_id = c.id
              and vc.presentacion_id = vl.presentacion_id
       where c.sucursal_id = ${sucursalId}
         and c.deleted_at is null
         and coalesce(vc.precio, vl.precio) is not null
    `.execute(this.db);

    return filas.rows.map((f) => ({
      id: `${f.cliente_id}:${f.presentacion_id}`,
      cliente_id: f.cliente_id,
      presentacion_id: f.presentacion_id,
      precio_centavos: aCentavos(f.precio),
      vigente_desde: fechaISO(f.vigente_desde),
      // Un precio no se da de baja: desaparece o cambia. Viaja siempre activo
      // para no inventar un estado que el portal no tiene.
      activo: 1,
    }));
  }

  /**
   * Notas por cobrar de los clientes de la sucursal.
   *
   * El alcance es **la sucursal, no el vendedor**: a un mismo cliente lo pueden
   * visitar varios vendedores (premisa registrada en [[Cliente]]), asi que el
   * que pasa hoy tiene que poder cobrar una nota que vendio otro. Lo que si es
   * estrictamente del vendedor es lo que **empuja**.
   */
  async notasPendientes(
    sucursalId: string,
    desde: Date | null,
  ): Promise<NotaPendientePull[]> {
    const filas = await sql<{
      id: string;
      folio: string;
      num_nota: string | null;
      fecha: string;
      cliente_id: string;
      status: string;
      monto_total: string;
      abonado: string;
      abonos: { fecha_pago: string; monto: string; metodo_pago: string }[];
      borrada: Date | null;
    }>`
      select vn.id, vn.folio, vn.num_nota,
             to_char(vn.fecha, 'YYYY-MM-DD') as fecha,
             vn.cliente_id, vn.status, vn.monto_total,
             coalesce(a.abonado, 0)::text as abonado,
             coalesce(a.abonos, '[]'::json) as abonos,
             vn.deleted_at as borrada
        from venta_nota vn
        join cliente c on c.id = vn.cliente_id
        left join lateral (
          select sum(ca.monto) as abonado,
                 json_agg(
                   json_build_object(
                     'fecha_pago', to_char(ca.fecha_pago, 'YYYY-MM-DD'),
                     'monto', ca.monto::text,
                     'metodo_pago', ca.metodo_pago
                   ) order by ca.fecha_pago, ca.created_at
                 ) as abonos
            from cobranza_abono ca
           where ca.venta_nota_id = vn.id
             and ca.deleted_at is null
        ) a on true
       where c.sucursal_id = ${sucursalId}
         and ${
           desde
             ? // Incremental: lo que cambio, incluidas las notas a credito que
               // se cerraron (D12). Una de contado nunca fue cobrable, salvo
               // que el portal la edite o elimine (T-17 parte 2: contado_credito
               // ya puede cambiar tras la creacion), asi que esas tambien viajan
               // para que la tablet las marque activo: 0.
               sql`vn.updated_at > ${desde}
                   and (vn.status in ('pendiente', 'abonado')
                        or vn.contado_credito = 'credito'
                        or vn.actualizado_por_usuario_id is not null
                        or vn.eliminado_por_usuario_id is not null)`
             : sql`vn.status in ('pendiente', 'abonado')`
         }
       order by vn.fecha, vn.folio
    `.execute(this.db);

    return filas.rows.map((f) => {
      const abierta = f.status === 'pendiente' || f.status === 'abonado';
      return {
        id: f.id,
        folio: f.folio,
        num_nota: f.num_nota,
        fecha: f.fecha,
        cliente_id: f.cliente_id,
        // Una nota cerrada viaja con un status que el CHECK de una tablet vieja
        // acepta; lo que la saca de la tablet es `activo: 0` (ver contrato).
        status: abierta
          ? (f.status as 'pendiente' | 'abonado')
          : f.abonos.length > 0
            ? 'abonado'
            : 'pendiente',
        monto_total_centavos: aCentavos(f.monto_total),
        // D7: derivado, nunca de la foto `saldo_pendiente`.
        saldo_centavos: Math.max(
          0,
          aCentavos(f.monto_total) - aCentavos(f.abonado),
        ),
        abonos: f.abonos.map((a) => ({
          fecha_pago: a.fecha_pago,
          monto_centavos: aCentavos(a.monto),
          metodo_pago: a.metodo_pago as MetodoPagoAbono,
        })),
        activo: abierta && f.borrada === null ? 1 : 0,
      };
    });
  }

  /**
   * La ruta diaria del vendedor del token (T-37, D12).
   *
   * - **Solo la suya**: el alcance de T-09 dice que un vendedor jala lo suyo.
   * - Solo `tipo = 'diaria'`: la semanal (T-36) no viaja.
   * - **Ventana por el reloj de Postgres**: desde ayer en adelante. La base
   *   corre en UTC; el `- 1` es lo que mantiene "hoy en Tijuana" dentro de la
   *   ventana despues de las 17:00 locales, cuando en UTC ya es manana. La
   *   tablet decide que dia muestra con su reloj local. No lo "corrijas" a la
   *   zona de Tijuana: el spec la fija asi.
   * - **Sin tope superior**, a proposito: con un tope (antes `+ 7`) y el cursor
   *   por `updated_at`, una ruta guardada hoy para dentro de 10 dias nunca
   *   bajaba: cuando entraba a la ventana su `updated_at` ya era anterior al
   *   `desde`, y la tablet solo hace pull completo una vez. Sin tope, una fila
   *   futura viaja en el pull siguiente a su creacion.
   * - Sin `desde`, solo las vivas. Con `desde`, todo lo que cambio: una fila que
   *   la oficina quito viaja con `activo: 0` (baja como bandera, nunca como
   *   ausencia; `ruta` no tiene columna `activo`).
   */
  async rutas(vendedorId: string, desde: Date | null): Promise<RutaPull[]> {
    let q = this.db
      .selectFrom('ruta')
      .select([
        'id',
        'cliente_id',
        // `date` -> texto en Postgres: el driver lo convertiria a Date en la
        // hora local del proceso.
        sql<string>`to_char(fecha, 'YYYY-MM-DD')`.as('fecha'),
        'orden',
        'origen',
        'deleted_at',
      ])
      .where('vendedor_id', '=', vendedorId)
      .where('tipo', '=', 'diaria')
      .where(sql<boolean>`fecha >= current_date - 1`);
    if (desde) {
      q = q.where('updated_at', '>', desde);
    } else {
      q = q.where('deleted_at', 'is', null);
    }

    return (await q.orderBy('fecha').orderBy('orden').execute()).map((f) => ({
      id: f.id,
      cliente_id: f.cliente_id,
      fecha: f.fecha,
      orden: f.orden,
      origen: f.origen as 'oficina' | 'vendedor',
      activo: bandera(true, f.deleted_at),
    }));
  }

  /**
   * Las promociones que la tablet necesita (T-74): las vivas de la sucursal del
   * vendedor. Por sucursal y no por vendedor: las de `todos` y `prospecto` son
   * de la sucursal, y las de `cliente` se crean en la sucursal del cliente
   * (PromocionesService.crear), asi que un solo filtro las cubre.
   *
   * Incremental por `updated_at`. Desactivar (`activo = false`) o dar de baja
   * (`deleted_at`) viajan igual, como `activo: 0`: la tablet la conserva porque
   * una venta local puede referenciarla, pero deja de aplicarla.
   */
  async promociones(
    sucursalId: string,
    desde: Date | null,
  ): Promise<PromocionPull[]> {
    let q = this.db
      .selectFrom('promocion')
      .select([
        'id',
        'audiencia',
        'cliente_id',
        'compra_tipo',
        'compra_producto_id',
        'compra_presentacion_id',
        'compra_cantidad',
        'regalo_tipo',
        'regalo_producto_id',
        'regalo_presentacion_id',
        'regalo_cantidad',
        'se_repite',
        'activo',
        'deleted_at',
      ])
      .where('sucursal_id', '=', sucursalId);
    if (desde) {
      q = q.where('updated_at', '>', desde);
    } else {
      q = q.where('deleted_at', 'is', null).where('activo', '=', true);
    }
    return (await q.orderBy('created_at').execute()).map((f) => ({
      id: f.id,
      audiencia: f.audiencia as PromocionPull['audiencia'],
      cliente_id: f.cliente_id,
      compra_tipo: f.compra_tipo as PromocionPull['compra_tipo'],
      compra_producto_id: f.compra_producto_id,
      compra_presentacion_id: f.compra_presentacion_id,
      compra_cantidad: f.compra_cantidad,
      regalo_tipo: f.regalo_tipo as PromocionPull['regalo_tipo'],
      regalo_producto_id: f.regalo_producto_id,
      regalo_presentacion_id: f.regalo_presentacion_id,
      regalo_cantidad: f.regalo_cantidad,
      se_repite: f.se_repite,
      activo: bandera(f.activo, f.deleted_at),
    }));
  }

  /* ---------------------------------------------------------------- */
  /* Push                                                              */
  /* ---------------------------------------------------------------- */

  /** De una lista de ids de cliente, cuales son de esta sucursal y estan vivos. */
  async clientesEnAlcance(
    sucursalId: string,
    ids: string[],
  ): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const filas = await this.db
      .selectFrom('cliente')
      .select('id')
      .where('sucursal_id', '=', sucursalId)
      .where('deleted_at', 'is', null)
      .where('id', 'in', ids)
      .execute();
    return new Set(filas.map((f) => f.id));
  }

  /**
   * Abre la transaccion de UNA operacion del lote (ADR-0009 §2.3).
   *
   * Vive en el repositorio para que el servicio no toque la conexion. Si `tarea`
   * lanza, Kysely hace `rollback` y relanza: ni el buzon ni las tablas de
   * negocio conservan nada de esa operacion (contrato §7).
   */
  async enTransaccion<T>(
    tarea: (trx: Transaction<DB>) => Promise<T>,
  ): Promise<T> {
    return this.db.transaction().execute(tarea);
  }

  /**
   * Guarda una operacion en el buzon, o descubre que ya estaba.
   *
   * `on conflict do nothing` + un `select` de respaldo, en vez de comprobar
   * antes si la clave existe: entre el SELECT y el INSERT de esa comprobacion
   * cabe el segundo intento del mismo lote, que es exactamente el caso que hay
   * que evitar. Quien decide es el unique de la base.
   *
   * Devuelve `duplicada: true` cuando la operacion ya estaba, con **el mismo
   * id** que devolvio el primer envio: es lo que hace que reintentar sea
   * seguro de punta a punta.
   *
   * > [!danger] Ya no atrapa el `23505` del folio (T-16)
   * > Corre dentro de la transaccion de la operacion. Un `unique_violation`
   * > aborta esa transaccion entera en Postgres, y cualquier consulta posterior
   * > con el mismo `trx` fallaria. Por eso el error sale tal cual y la
   * > clasificacion (`buscarPorClave` / `duenoDelFolio`) la hace el servicio
   * > **despues del rollback**, con la conexion normal.
   */
  async guardarOperacion(
    vendedorId: string,
    sucursalId: string,
    contrato: number,
    op: OperacionNormalizada,
    trx: Transaction<DB>,
  ): Promise<ResultadoGuardado> {
    const insertada = await trx
      .insertInto('sync_operacion')
      .values({
        vendedor_id: vendedorId,
        sucursal_id: sucursalId,
        clave_idempotencia: op.clave,
        tipo: op.tipo,
        contrato,
        fecha_operacion: op.fechaOperacion,
        ocurrido_en: op.ocurridoEn,
        folio: op.folio,
        // El `cliente_id` del sobre gana (venta, cobranza). Si el sobre no trae
        // uno, se conserva el de `datos`: un `ruta-alta` (T-37) lo lleva ahi, y
        // pisarlo con null dejaba el buzon sin saber de que cliente era.
        datos: JSON.stringify({
          ...op.datos,
          cliente_id: op.clienteId ?? op.datos.cliente_id ?? null,
        }),
      })
      .onConflict((oc) =>
        oc.columns(['vendedor_id', 'clave_idempotencia']).doNothing(),
      )
      .returning('id')
      .executeTakeFirst();

    if (insertada) return { id: insertada.id, duplicada: false };

    const existente = await trx
      .selectFrom('sync_operacion')
      .select('id')
      .where('vendedor_id', '=', vendedorId)
      .where('clave_idempotencia', '=', op.clave)
      .executeTakeFirstOrThrow();

    return { id: existente.id, duplicada: true };
  }

  /**
   * Anota en el buzon a que fila de negocio se convirtio la operacion.
   *
   * Enmienda de T-16 a ADR-0009 §2.4: T-07 dejo `entidad_tabla` / `entidad_id`
   * precisamente para esto, asi que no hace falta un `sync_operacion_id` en
   * cada tabla de negocio; el camino inverso lo da el folio. Mientras nadie la
   * proyecte, una operacion queda con `entidad_id` nulo y la sigue listando
   * `idx_sync_operacion_sin_proyectar`.
   */
  async marcarProyectada(
    syncOperacionId: string,
    entidad: EntidadProyectada,
    trx: Transaction<DB>,
  ): Promise<void> {
    await trx
      .updateTable('sync_operacion')
      .set({ entidad_tabla: entidad.tabla, entidad_id: entidad.id })
      .where('id', '=', syncOperacionId)
      .execute();
  }

  /**
   * La operacion de este vendedor con esa clave, si ya estaba guardada.
   *
   * Usa la conexion normal a proposito: se llama **despues** del rollback de una
   * colision de folio, cuando la transaccion ya no sirve (T-16).
   */
  async buscarPorClave(
    vendedorId: string,
    clave: string,
  ): Promise<{ id: string } | undefined> {
    return this.db
      .selectFrom('sync_operacion')
      .select('id')
      .where('vendedor_id', '=', vendedorId)
      .where('clave_idempotencia', '=', clave)
      .executeTakeFirst();
  }

  /**
   * Quien ya se habia quedado con este folio.
   *
   * Solo se consulta para poder **explicar** la colision. El rechazo ya lo
   * decidio la base; esto es el mensaje que leera quien tenga la tablet.
   */
  async duenoDelFolio(
    folio: string,
  ): Promise<{ vendedorId: string; clave: string } | null> {
    const fila = await this.db
      .selectFrom('sync_operacion')
      .select(['vendedor_id', 'clave_idempotencia'])
      .where('folio', '=', folio)
      .executeTakeFirst();

    return fila
      ? { vendedorId: fila.vendedor_id, clave: fila.clave_idempotencia }
      : null;
  }
}

/** Resultado de guardar una operacion en el buzon: entro, o ya estaba. */
export interface ResultadoGuardado {
  id: string;
  duplicada: boolean;
}

/** La fila de negocio en la que se convirtio una operacion (ADR-0009 §2.4, enmendado). */
export interface EntidadProyectada {
  tabla: string;
  id: string;
}

/** `date` de Postgres → `AAAA-MM-DD` sin pasar por UTC. */
function fechaISO(valor: Date | string): string {
  if (typeof valor === 'string') return valor.slice(0, 10);
  // El driver construye la Date con la fecha en hora LOCAL del proceso, asi que
  // `toISOString()` la puede correr un dia hacia atras. Se leen los componentes
  // locales, que son los que el driver puso.
  const mes = `${valor.getMonth() + 1}`.padStart(2, '0');
  const dia = `${valor.getDate()}`.padStart(2, '0');
  return `${valor.getFullYear()}-${mes}-${dia}`;
}
