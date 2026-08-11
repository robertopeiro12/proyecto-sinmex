import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DB_CONNECTION, type Database } from '../../database/database.tokens';
import type {
  ClientePull,
  NotaPendientePull,
  PrecioPull,
  PresentacionPull,
  ProductoPull,
  SucursalPull,
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
      .select([
        'id',
        'login',
        'nombre',
        'sucursal_id',
        'activo',
        'folio_segmento',
        'deleted_at',
      ])
      .where('id', '=', vendedorId);
    if (desde) q = q.where('updated_at', '>', desde);

    return (await q.execute()).map((f) => ({
      id: f.id,
      login: f.login,
      nombre: f.nombre,
      sucursal_id: f.sucursal_id,
      // Lo asigna el servidor porque la tablet no puede: solo baja su propia
      // ficha, asi que no ve si otro vendedor comparte sus iniciales (T-14).
      folio_segmento: f.folio_segmento,
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
        'promocion',
        'plazo_credito_dias',
        'lat',
        'lng',
        'sucursal_id',
        'deleted_at',
      ])
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
      promocion: f.promocion as 'ninguna' | '10+1' | '20+1',
      plazo_credito_dias: f.plazo_credito_dias,
      lat: aNumero(f.lat),
      lng: aNumero(f.lng),
      sucursal_id: f.sucursal_id,
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
      num_nota: string;
      fecha: Date;
      cliente_id: string;
      status: string;
      monto_total: string;
      saldo: string | null;
      borrada: Date | null;
    }>`
      select vn.id, vn.folio, vn.num_nota, vn.fecha, vn.cliente_id, vn.status,
             vn.monto_total,
             (select ca.saldo_pendiente
                from cobranza_abono ca
               where ca.venta_nota_id = vn.id
                 and ca.deleted_at is null
               order by ca.fecha_pago desc, ca.created_at desc
               limit 1) as saldo,
             vn.deleted_at as borrada
        from venta_nota vn
        join cliente c on c.id = vn.cliente_id
       where c.sucursal_id = ${sucursalId}
         and vn.status in ('pendiente', 'abonado')
         ${desde ? sql`and vn.updated_at > ${desde}` : sql``}
       order by vn.fecha
    `.execute(this.db);

    return filas.rows.map((f) => ({
      id: f.id,
      folio: f.folio,
      num_nota: f.num_nota,
      fecha: fechaISO(f.fecha),
      cliente_id: f.cliente_id,
      status: f.status as 'pendiente' | 'abonado',
      monto_total_centavos: aCentavos(f.monto_total),
      // El saldo del ultimo abono; si no hay ninguno, la nota entera sigue a
      // deber. Ver la advertencia de `NotaPendientePull` en `contrato.ts`.
      saldo_centavos:
        f.saldo === null ? aCentavos(f.monto_total) : aCentavos(f.saldo),
      activo: bandera(true, f.borrada),
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
   * Guarda una operacion, o descubre que ya estaba.
   *
   * `on conflict do nothing` + un `select` de respaldo, en vez de comprobar
   * antes si la clave existe: entre el SELECT y el INSERT de esa comprobacion
   * cabe el segundo intento del mismo lote, que es exactamente el caso que hay
   * que evitar. Quien decide es el unique de la base.
   *
   * Devuelve `duplicada: true` cuando la operacion ya estaba, con **el mismo
   * id** que devolvio el primer envio: es lo que hace que reintentar sea
   * seguro de punta a punta.
   */
  async guardarOperacion(
    vendedorId: string,
    sucursalId: string,
    contrato: number,
    op: OperacionNormalizada,
  ): Promise<ResultadoGuardado> {
    let insertada: { id: string } | undefined;
    try {
      insertada = await this.db
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
          datos: JSON.stringify({ ...op.datos, cliente_id: op.clienteId }),
        })
        .onConflict((oc) =>
          oc.columns(['vendedor_id', 'clave_idempotencia']).doNothing(),
        )
        .returning('id')
        .executeTakeFirst();
    } catch (error) {
      // Aqui solo puede caer la violacion del unique del FOLIO: la de la clave
      // de idempotencia la absorbe el `on conflict do nothing` de arriba.
      //
      // > [!danger] No todo 23505 de folio es una colision
      // > El caso normal (reenvio secuencial del mismo lote) ni siquiera llega
      // > aqui: el `on conflict (vendedor_id, clave_idempotencia) do nothing`
      // > comprueba su indice arbitro primero, no intenta el insert y el unique
      // > del folio nunca se dispara. Eso esta cubierto por un e2e.
      // >
      // > Pero `do nothing` **solo** absorbe conflictos de su arbitro. Si dos
      // > peticiones identicas se solapan, la segunda puede no ver todavia la
      // > fila de la primera (sin commit), seguir adelante y chocar contra el
      // > unique del FOLIO — un 23505 para lo que en realidad es un reenvio.
      // >
      // > Por eso se desempata mirando la clave: si esa fila ya existe, era un
      // > reenvio (`duplicada`); solo si no existe es una colision de verdad.
      // > Traducir todo 23505 a `folio-duplicado` dejaria esos reintentos en
      // > error para siempre — lo contrario de lo que promete T-07.
      // >
      // > Es **defensivo**: no se ha conseguido forzar ese solape desde una
      // > prueba, asi que esta rama no esta cubierta por un test que falle sin
      // > ella. Se conserva porque el modo de fallo que evita es peor que su
      // > coste (una consulta que solo corre cuando ya hubo un 23505).
      if (!esViolacionDeUnico(error)) throw error;

      const propia = await this.buscarPorClave(vendedorId, op.clave);
      if (propia) return { id: propia.id, duplicada: true };

      return { colisionDeFolio: true };
    }

    if (insertada) return { id: insertada.id, duplicada: false };

    const existente = await this.db
      .selectFrom('sync_operacion')
      .select('id')
      .where('vendedor_id', '=', vendedorId)
      .where('clave_idempotencia', '=', op.clave)
      .executeTakeFirstOrThrow();

    return { id: existente.id, duplicada: true };
  }

  /** La operacion de este vendedor con esa clave, si ya estaba guardada. */
  private async buscarPorClave(
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

/**
 * Resultado de guardar una operacion: entro, ya estaba, o **su folio choco con
 * el de otra operacion** (T-14).
 */
export type ResultadoGuardado =
  | { id: string; duplicada: boolean; colisionDeFolio?: false }
  | { colisionDeFolio: true; id?: undefined; duplicada?: undefined };

/** `23505 unique_violation` de Postgres. */
function esViolacionDeUnico(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === '23505'
  );
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
