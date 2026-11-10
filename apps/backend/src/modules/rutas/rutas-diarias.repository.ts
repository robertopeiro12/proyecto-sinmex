import { Inject, Injectable } from '@nestjs/common';
import { sql, type Transaction } from 'kysely';
import { DB_CONNECTION, type Database } from '../../database/database.tokens';
import type { DB } from '../../database/schema';
import { buscarSucursalUsuario as buscarSucursalUsuarioCompartido } from '../sucursales/buscar-sucursal-usuario';
import type { FilaViva, PlanReemplazo } from './reemplazo-ruta';

export type OrigenRuta = 'oficina' | 'vendedor' | 'semanal';

/** Una fila de `ruta` diaria lista para escribir. */
export interface NuevaFilaRuta {
  vendedorId: string;
  clienteId: string;
  /** `AAAA-MM-DD`. En un alta de la tablet, la `fecha_operacion` tal cual. */
  fecha: string;
  orden: number;
  origen: OrigenRuta;
}

/** El vendedor de una ruta, con su sucursal (para el alcance y la cartera). */
export interface VendedorDeRuta {
  id: string;
  nombre: string;
  sucursalId: string;
  sucursalCodigo: string;
}

/** Una fila de la ruta como la pinta el portal. */
export interface FilaRutaDiaria {
  id: string;
  clienteId: string;
  clienteNombre: string;
  orden: number;
  origen: OrigenRuta;
  /** Lo que la oficina le dice al vendedor de ese cliente, o `null`. */
  recado: string | null;
  /** Notas de ese cliente asignadas a este vendedor ese dia (vivas). */
  notasAsignadas: number;
}

/** El encabezado vivo (`ruta_dia`) de la ruta de un vendedor y dia. */
export interface RutaDiaGuardada {
  id: string;
  /** `null` = "Sin ruta". */
  rutaSemanalId: string | null;
  /** El nombre congelado al asignar (no cambia si la renombran despues de ese dia). */
  nombreRuta: string | null;
  vehiculoId: string | null;
  vehiculoNombre: string | null;
}

/**
 * SQL de la ruta diaria (T-37).
 *
 * Los metodos del push reciben la `trx` de la operacion y ninguno abre la suya:
 * el alta entra o sale junto con su fila del buzon (ADR-0009 §2.3). Los del
 * portal usan `enTransaccion`. Toda escritura de la ruta de un dia (`ruta`,
 * `ruta_dia` y las `nota_asignada` que salen con ella) vive aqui, tambien la
 * de la propagacion de la Ruta Semanal.
 */
@Injectable()
export class RutasDiariasRepository {
  constructor(@Inject(DB_CONNECTION) private readonly db: Database) {}

  /**
   * ¿El cliente existe, no esta dado de baja, es de esa sucursal y es
   * `tipo = 'cliente'`? A un prospecto no se le vende (D7), asi que no entra a
   * la ruta.
   */
  async clienteParaRuta(
    clienteId: string,
    sucursalId: string,
    trx: Transaction<DB>,
  ): Promise<boolean> {
    const fila = await trx
      .selectFrom('cliente')
      .select('id')
      .where('id', '=', clienteId)
      .where('sucursal_id', '=', sucursalId)
      .where('tipo', '=', 'cliente')
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    return fila !== undefined;
  }

  /**
   * Bloquea la fila del vendedor hasta el fin de la transaccion.
   *
   * Es el candado comun del alta (push) y del reemplazo (portal) de la ruta de
   * ese vendedor: sin el, dos transacciones calculan el mismo orden siguiente, o
   * el portal lee las vivas antes de que un alta haga commit y revienta con
   * `23505`. `for no key update` y no `for update`: no bloquea los inserts de
   * otras tablas que solo referencian al vendedor (ventas, jornada).
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

  /** `max(orden) + 1` entre las vivas de ese vendedor y dia, o `1` si no hay. */
  async siguienteOrden(
    vendedorId: string,
    fecha: string,
    trx: Transaction<DB>,
  ): Promise<number> {
    const fila = await trx
      .selectFrom('ruta')
      .select(sql<number>`coalesce(max(orden), 0) + 1`.as('siguiente'))
      .where('vendedor_id', '=', vendedorId)
      .where(sql<boolean>`fecha = ${fecha}::date`)
      .where('tipo', '=', 'diaria')
      .where('deleted_at', 'is', null)
      .executeTakeFirstOrThrow();
    return Number(fila.siguiente);
  }

  /**
   * Inserta la fila, o devuelve `null` si ese vendedor ya tenia a ese cliente
   * vivo en la ruta diaria de ese dia (`uq_ruta_diaria_vendedor_fecha_cliente`).
   *
   * `on conflict ... do nothing` y no atrapar el `23505`: un `unique_violation`
   * aborta la transaccion entera de Postgres (T-16, D10). El predicado del
   * indice parcial va entero para que Postgres lo pueda usar como arbitro, y el
   * `tipo = 'diaria'` va LITERAL (no como parametro `$n`): la inferencia del
   * indice compara contra constantes.
   */
  async insertarSiNoExiste(
    nueva: NuevaFilaRuta,
    trx: Transaction<DB>,
  ): Promise<string | null> {
    const fila = await trx
      .insertInto('ruta')
      .values({
        vendedor_id: nueva.vendedorId,
        cliente_id: nueva.clienteId,
        fecha: nueva.fecha,
        orden: nueva.orden,
        origen: nueva.origen,
        tipo: 'diaria',
      })
      .onConflict((oc) =>
        oc
          .columns(['vendedor_id', 'fecha', 'cliente_id'])
          .where('deleted_at', 'is', null)
          .where(sql<boolean>`tipo = 'diaria'`)
          .doNothing(),
      )
      .returning('id')
      .executeTakeFirst();
    return fila?.id ?? null;
  }

  /** Abre la transaccion del reemplazo del portal. */
  async enTransaccion<T>(
    tarea: (trx: Transaction<DB>) => Promise<T>,
  ): Promise<T> {
    return this.db.transaction().execute(tarea);
  }

  buscarSucursalUsuario(
    usuarioId: string,
  ): Promise<{ id: string | null; codigo: string | null } | undefined> {
    return buscarSucursalUsuarioCompartido(this.db, usuarioId);
  }

  /** El vendedor vivo (sin `deleted_at`), activo o no. */
  async vendedorDeRuta(
    vendedorId: string,
  ): Promise<VendedorDeRuta | undefined> {
    return this.db
      .selectFrom('vendedor')
      .innerJoin('sucursal', 'sucursal.id', 'vendedor.sucursal_id')
      .select([
        'vendedor.id as id',
        'vendedor.nombre as nombre',
        'vendedor.sucursal_id as sucursalId',
        'sucursal.codigo as sucursalCodigo',
      ])
      .where('vendedor.id', '=', vendedorId)
      .where('vendedor.deleted_at', 'is', null)
      .executeTakeFirst();
  }

  /** Las filas vivas de la ruta diaria de un vendedor y dia, por orden, con el nombre del cliente. */
  async filasDelDia(
    vendedorId: string,
    fecha: string,
  ): Promise<FilaRutaDiaria[]> {
    const filas = await this.db
      .selectFrom('ruta')
      .innerJoin('cliente', 'cliente.id', 'ruta.cliente_id')
      .select([
        'ruta.id as id',
        'ruta.cliente_id as clienteId',
        'cliente.nombre as clienteNombre',
        'ruta.orden as orden',
        'ruta.origen as origen',
        'ruta.recado as recado',
        (eb) =>
          eb
            .selectFrom('nota_asignada as na')
            .innerJoin('venta_nota as vn', 'vn.id', 'na.venta_nota_id')
            .select(sql<number>`count(*)::int`.as('n'))
            .whereRef('vn.cliente_id', '=', 'ruta.cliente_id')
            .whereRef('na.vendedor_id', '=', 'ruta.vendedor_id')
            .whereRef('na.fecha', '=', 'ruta.fecha')
            .where('na.deleted_at', 'is', null)
            .where('vn.deleted_at', 'is', null)
            .as('notasAsignadas'),
      ])
      .where('ruta.vendedor_id', '=', vendedorId)
      .where(sql<boolean>`ruta.fecha = ${fecha}::date`)
      .where('ruta.tipo', '=', 'diaria')
      .where('ruta.deleted_at', 'is', null)
      .orderBy('ruta.orden')
      .orderBy('ruta.created_at')
      .execute();
    return filas.map((f) => ({
      ...f,
      origen: f.origen as OrigenRuta,
      notasAsignadas: Number(f.notasAsignadas ?? 0),
    }));
  }

  /** Lo mismo, dentro de la transaccion y sin nombre: lo que lee el reemplazo. */
  async filasVivas(
    vendedorId: string,
    fecha: string,
    trx: Transaction<DB>,
  ): Promise<FilaViva[]> {
    const filas = await trx
      .selectFrom('ruta')
      .select(['id', 'cliente_id', 'orden', 'origen', 'recado'])
      .where('vendedor_id', '=', vendedorId)
      .where(sql<boolean>`fecha = ${fecha}::date`)
      .where('tipo', '=', 'diaria')
      .where('deleted_at', 'is', null)
      .orderBy('orden')
      .execute();
    return filas.map((f) => ({
      id: f.id,
      clienteId: f.cliente_id,
      orden: f.orden,
      origen: f.origen as OrigenRuta,
      recado: f.recado,
    }));
  }

  /** De una lista de ids, cuales son clientes vivos, `tipo = 'cliente'`, de esa sucursal. */
  async clientesParaRuta(
    ids: readonly string[],
    sucursalId: string,
    trx: Transaction<DB>,
  ): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const filas = await trx
      .selectFrom('cliente')
      .select('id')
      .where('id', 'in', [...ids])
      .where('sucursal_id', '=', sucursalId)
      .where('tipo', '=', 'cliente')
      .where('deleted_at', 'is', null)
      .execute();
    return new Set(filas.map((f) => f.id));
  }

  /**
   * Nombre de cada id que sea un cliente de ESA sucursal (la del vendedor, que
   * el usuario ya alcanza), borrado o prospecto incluidos: para nombrar en el
   * 400 a los clientes que no valen. Un id de otra sucursal o que ni existe no
   * viene en el mapa: nombrarlo filtraria datos de una sucursal que el usuario
   * no alcanza.
   */
  async nombresDeClientes(
    ids: readonly string[],
    sucursalId: string,
    trx: Transaction<DB>,
  ): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const filas = await trx
      .selectFrom('cliente')
      .select(['id', 'nombre'])
      .where('id', 'in', [...ids])
      .where('sucursal_id', '=', sucursalId)
      .execute();
    return new Map(filas.map((f) => [f.id, f.nombre]));
  }

  /**
   * Escribe el plan del reemplazo. La fila del vendedor ya esta bloqueada y las
   * vivas se leyeron despues del candado, asi que los inserts no pueden chocar
   * con la unicidad.
   */
  async aplicarReemplazo(
    vendedorId: string,
    fecha: string,
    plan: PlanReemplazo,
    trx: Transaction<DB>,
  ): Promise<void> {
    for (const fila of plan.borrar) {
      await trx
        .updateTable('ruta')
        .set({ deleted_at: new Date(), quitado_por: fila.quitadoPor })
        .where('id', '=', fila.id)
        .execute();
    }
    for (const fila of plan.actualizar) {
      await trx
        .updateTable('ruta')
        .set({ orden: fila.orden, recado: fila.recado })
        .where('id', '=', fila.id)
        .execute();
    }
    if (plan.insertar.length > 0) {
      await trx
        .insertInto('ruta')
        .values(
          plan.insertar.map((fila) => ({
            vendedor_id: vendedorId,
            cliente_id: fila.clienteId,
            fecha,
            orden: fila.orden,
            origen: fila.origen,
            recado: fila.recado,
            tipo: 'diaria',
          })),
        )
        .execute();
    }
  }

  /**
   * La ruta del dia (encabezado) viva de ese vendedor y dia, con el nombre de
   * su vehiculo, o `undefined` (una ruta de T-37 o un dia sin nada).
   */
  async rutaDia(
    vendedorId: string,
    fecha: string,
    trx?: Transaction<DB>,
  ): Promise<RutaDiaGuardada | undefined> {
    return (trx ?? this.db)
      .selectFrom('ruta_dia as rd')
      .leftJoin('vehiculo as vh', 'vh.id', 'rd.vehiculo_id')
      .select([
        'rd.id as id',
        'rd.ruta_semanal_id as rutaSemanalId',
        'rd.nombre_ruta as nombreRuta',
        'rd.vehiculo_id as vehiculoId',
        'vh.nombre as vehiculoNombre',
      ])
      .where('rd.vendedor_id', '=', vendedorId)
      .where(sql<boolean>`rd.fecha = ${fecha}::date`)
      .where('rd.deleted_at', 'is', null)
      .executeTakeFirst();
  }

  /**
   * El nombre del OTRO vendedor que trae esa ruta semanal ese dia, o
   * `undefined`. Se llama con la `ruta_semanal` ya bloqueada: quien asigna la
   * misma ruta espera ese candado, asi que la respuesta no cambia antes del
   * commit (`uq_ruta_dia_semanal_fecha` queda como red).
   */
  async quienTraeLaRuta(
    rutaSemanalId: string,
    fecha: string,
    vendedorId: string,
    trx: Transaction<DB>,
  ): Promise<string | undefined> {
    const fila = await trx
      .selectFrom('ruta_dia as rd')
      .innerJoin('vendedor as v', 'v.id', 'rd.vendedor_id')
      .select('v.nombre')
      .where('rd.ruta_semanal_id', '=', rutaSemanalId)
      .where(sql<boolean>`rd.fecha = ${fecha}::date`)
      .where('rd.deleted_at', 'is', null)
      .where('rd.vendedor_id', '<>', vendedorId)
      .executeTakeFirst();
    return fila?.nombre;
  }

  /** ¿El vehiculo esta vivo, activo y es de esa sucursal? */
  async vehiculoParaRuta(
    vehiculoId: string,
    sucursalId: string,
    trx: Transaction<DB>,
  ): Promise<boolean> {
    const fila = await trx
      .selectFrom('vehiculo')
      .select('id')
      .where('id', '=', vehiculoId)
      .where('sucursal_id', '=', sucursalId)
      .where('activo', '=', true)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    return fila !== undefined;
  }

  /**
   * Crea o actualiza el encabezado de la ruta de ese vendedor y dia. El
   * vendedor ya esta bloqueado, asi que el alta no choca con
   * `uq_ruta_dia_vendedor_fecha`. Si nada cambia no se escribe: moveria
   * `updated_at` y bajaria otra vez en el pull.
   */
  async guardarRutaDia(
    datos: {
      vendedorId: string;
      fecha: string;
      rutaSemanalId: string | null;
      nombreRuta: string | null;
      vehiculoId: string | null;
      usuarioId: string;
    },
    guardada: RutaDiaGuardada | undefined,
    trx: Transaction<DB>,
  ): Promise<void> {
    if (!guardada) {
      await trx
        .insertInto('ruta_dia')
        .values({
          vendedor_id: datos.vendedorId,
          fecha: datos.fecha,
          ruta_semanal_id: datos.rutaSemanalId,
          nombre_ruta: datos.nombreRuta,
          vehiculo_id: datos.vehiculoId,
          actualizado_por_usuario_id: datos.usuarioId,
        })
        .execute();
      return;
    }
    if (
      guardada.rutaSemanalId === datos.rutaSemanalId &&
      guardada.nombreRuta === datos.nombreRuta &&
      guardada.vehiculoId === datos.vehiculoId
    ) {
      return;
    }
    await trx
      .updateTable('ruta_dia')
      .set({
        ruta_semanal_id: datos.rutaSemanalId,
        nombre_ruta: datos.nombreRuta,
        vehiculo_id: datos.vehiculoId,
        actualizado_por_usuario_id: datos.usuarioId,
      })
      .where('id', '=', guardada.id)
      .execute();
  }

  /** Baja de un encabezado (una ruta que se guardo sin semanal, sin vehiculo y sin clientes). */
  async darDeBajaRutaDia(
    id: string,
    usuarioId: string,
    trx: Transaction<DB>,
  ): Promise<void> {
    await trx
      .updateTable('ruta_dia')
      .set({ deleted_at: new Date(), actualizado_por_usuario_id: usuarioId })
      .where('id', '=', id)
      .execute();
  }

  /**
   * "Quitar ruta": baja del encabezado, de las filas que puso la oficina o la
   * semanal (`quitado_por = 'cambio_ruta'`: si se vuelve a asignar, entran
   * otra vez) y de las notas asignadas a ese vendedor ese dia. Las filas del
   * vendedor se quedan. El vendedor ya esta bloqueado.
   */
  async quitarRutaDia(
    vendedorId: string,
    fecha: string,
    usuarioId: string,
    trx: Transaction<DB>,
  ): Promise<void> {
    const ahora = new Date();
    await trx
      .updateTable('ruta_dia')
      .set({ deleted_at: ahora, actualizado_por_usuario_id: usuarioId })
      .where('vendedor_id', '=', vendedorId)
      .where(sql<boolean>`fecha = ${fecha}::date`)
      .where('deleted_at', 'is', null)
      .execute();
    await trx
      .updateTable('ruta')
      .set({ deleted_at: ahora, quitado_por: 'cambio_ruta' })
      .where('vendedor_id', '=', vendedorId)
      .where(sql<boolean>`fecha = ${fecha}::date`)
      .where('tipo', '=', 'diaria')
      .where('origen', 'in', ['oficina', 'semanal'])
      .where('deleted_at', 'is', null)
      .execute();
    await trx
      .updateTable('nota_asignada')
      .set({ deleted_at: ahora, quitada_por_usuario_id: usuarioId })
      .where('vendedor_id', '=', vendedorId)
      .where(sql<boolean>`fecha = ${fecha}::date`)
      .where('deleted_at', 'is', null)
      .execute();
  }

  /** Baja de las notas asignadas a ese vendedor ese dia de los clientes que salieron de su ruta. */
  async quitarNotasAsignadas(
    vendedorId: string,
    fecha: string,
    clienteIds: readonly string[],
    usuarioId: string,
    trx: Transaction<DB>,
  ): Promise<void> {
    if (clienteIds.length === 0) return;
    await trx
      .updateTable('nota_asignada')
      .set({ deleted_at: new Date(), quitada_por_usuario_id: usuarioId })
      .where('vendedor_id', '=', vendedorId)
      .where(sql<boolean>`fecha = ${fecha}::date`)
      .where('deleted_at', 'is', null)
      .where('venta_nota_id', 'in', (eb) =>
        eb
          .selectFrom('venta_nota')
          .select('id')
          .where('cliente_id', 'in', [...clienteIds]),
      )
      .execute();
  }

  /**
   * Las rutas semanales vivas de esa sucursal y dia de la semana, por nombre,
   * con el OTRO vendedor que la trae esa fecha (o `null`).
   */
  async rutasParaElDia(
    sucursalId: string,
    diaSemana: number,
    fecha: string,
    vendedorId: string,
  ): Promise<{ id: string; nombre: string; ocupadaPor: string | null }[]> {
    const filas = await this.db
      .selectFrom('ruta_semanal as rs')
      .leftJoin('ruta_dia as rd', (j) =>
        j
          .onRef('rd.ruta_semanal_id', '=', 'rs.id')
          .on(sql<boolean>`rd.fecha = ${fecha}::date`)
          .on('rd.deleted_at', 'is', null)
          .on('rd.vendedor_id', '<>', vendedorId),
      )
      .leftJoin('vendedor as v', 'v.id', 'rd.vendedor_id')
      .select(['rs.id as id', 'rs.nombre as nombre', 'v.nombre as ocupadaPor'])
      .where('rs.sucursal_id', '=', sucursalId)
      .where('rs.dia_semana', '=', diaSemana)
      .where('rs.deleted_at', 'is', null)
      .orderBy(sql`lower(rs.nombre)`)
      .execute();
    return filas;
  }

  /**
   * Los vehiculos vivos y activos de esa sucursal, por nombre, con el OTRO
   * vendedor que lo trae esa fecha (o `null`; si son varios, el primero por
   * nombre). Un vehiculo ocupado se puede escoger: solo se avisa.
   */
  async vehiculosParaElDia(
    sucursalId: string,
    fecha: string,
    vendedorId: string,
  ): Promise<{ id: string; nombre: string; ocupadoPor: string | null }[]> {
    const filas = await this.db
      .selectFrom('vehiculo as vh')
      .select([
        'vh.id as id',
        'vh.nombre as nombre',
        (eb) =>
          eb
            .selectFrom('ruta_dia as rd')
            .innerJoin('vendedor as v', 'v.id', 'rd.vendedor_id')
            .select('v.nombre')
            .whereRef('rd.vehiculo_id', '=', 'vh.id')
            .where(sql<boolean>`rd.fecha = ${fecha}::date`)
            .where('rd.deleted_at', 'is', null)
            .where('rd.vendedor_id', '<>', vendedorId)
            .orderBy('v.nombre')
            .limit(1)
            .as('ocupadoPor'),
      ])
      .where('vh.sucursal_id', '=', sucursalId)
      .where('vh.activo', '=', true)
      .where('vh.deleted_at', 'is', null)
      .orderBy(sql`lower(vh.nombre)`)
      .execute();
    return filas.map((f) => ({ ...f, ocupadoPor: f.ocupadoPor ?? null }));
  }

  /** Los vendedores vivos y ACTIVOS de una sucursal (por codigo), por nombre. */
  async vendedoresActivos(sucursalCodigo: string): Promise<VendedorDeRuta[]> {
    return this.db
      .selectFrom('vendedor')
      .innerJoin('sucursal', 'sucursal.id', 'vendedor.sucursal_id')
      .select([
        'vendedor.id as id',
        'vendedor.nombre as nombre',
        'vendedor.sucursal_id as sucursalId',
        'sucursal.codigo as sucursalCodigo',
      ])
      .where('sucursal.codigo', '=', sucursalCodigo)
      .where('vendedor.activo', '=', true)
      .where('vendedor.deleted_at', 'is', null)
      .orderBy(sql`lower(vendedor.nombre)`)
      .execute();
  }

  /**
   * Lo que pinta la lista del dia de esos vendedores: su encabezado (si hay),
   * los clientes vivos de su ruta y cuantas notas tiene asignadas.
   */
  async resumenDelDia(
    vendedorIds: readonly string[],
    fecha: string,
  ): Promise<
    Map<
      string,
      {
        rutaDia: RutaDiaGuardada | undefined;
        clientes: string[];
        notasAsignadas: number;
      }
    >
  > {
    const resumen = new Map(
      vendedorIds.map((id) => [
        id,
        {
          rutaDia: undefined as RutaDiaGuardada | undefined,
          clientes: [] as string[],
          notasAsignadas: 0,
        },
      ]),
    );
    if (vendedorIds.length === 0) return resumen;
    const ids = [...vendedorIds];

    const encabezados = await this.db
      .selectFrom('ruta_dia as rd')
      .leftJoin('vehiculo as vh', 'vh.id', 'rd.vehiculo_id')
      .select([
        'rd.vendedor_id as vendedorId',
        'rd.id as id',
        'rd.ruta_semanal_id as rutaSemanalId',
        'rd.nombre_ruta as nombreRuta',
        'rd.vehiculo_id as vehiculoId',
        'vh.nombre as vehiculoNombre',
      ])
      .where('rd.vendedor_id', 'in', ids)
      .where(sql<boolean>`rd.fecha = ${fecha}::date`)
      .where('rd.deleted_at', 'is', null)
      .execute();
    for (const { vendedorId, ...rutaDia } of encabezados) {
      resumen.get(vendedorId)!.rutaDia = rutaDia;
    }

    const filas = await this.db
      .selectFrom('ruta')
      .select(['vendedor_id', 'cliente_id'])
      .where('vendedor_id', 'in', ids)
      .where(sql<boolean>`fecha = ${fecha}::date`)
      .where('tipo', '=', 'diaria')
      .where('deleted_at', 'is', null)
      .orderBy('orden')
      .execute();
    for (const f of filas)
      resumen.get(f.vendedor_id)!.clientes.push(f.cliente_id);

    // Una nota de una venta eliminada (T-17) ya no cuenta como asignada.
    const notas = await this.db
      .selectFrom('nota_asignada as na')
      .innerJoin('venta_nota as vn', 'vn.id', 'na.venta_nota_id')
      .select(['na.vendedor_id', sql<number>`count(*)::int`.as('n')])
      .where('na.vendedor_id', 'in', ids)
      .where(sql<boolean>`na.fecha = ${fecha}::date`)
      .where('na.deleted_at', 'is', null)
      .where('vn.deleted_at', 'is', null)
      .groupBy('na.vendedor_id')
      .execute();
    for (const n of notas) {
      resumen.get(n.vendedor_id)!.notasAsignadas = Number(n.n);
    }

    return resumen;
  }
}
