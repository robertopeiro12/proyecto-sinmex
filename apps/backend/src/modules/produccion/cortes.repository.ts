import { Inject, Injectable } from '@nestjs/common';
import { sql, type Kysely, type Transaction } from 'kysely';
import { DB_CONNECTION, type Database } from '../../database/database.tokens';
import type { DB } from '../../database/schema';
import { buscarSucursalUsuario } from '../sucursales/buscar-sucursal-usuario';
import type {
  ConteoPedido,
  ConteoVivo,
  MovimientoPresentacion,
} from './reglas-corte';

/** El vendedor (vivo, activo o no) con su sucursal: el alcance y la `sucursal_id` del corte. */
export interface VendedorCorte {
  id: string;
  nombre: string;
  sucursalId: string;
  sucursalCodigo: string;
}

/** El encabezado vivo del corte: cuando se hizo y quien. */
export interface EncabezadoCorte {
  hechoEn: string;
  hechoPor: string;
}

/** Un vendedor de la lista del dia, con su encabezado si ya se hizo el corte. */
export interface VendedorDelDia extends VendedorCorte {
  hechoEn: string | null;
}

/** Los movimientos de una presentacion de un vendedor. */
export interface MovimientoVendedor extends MovimientoPresentacion {
  vendedorId: string;
}

/** Que dia de que vendedor. */
export interface DiaVendedor {
  vendedorId: string;
  /** `AAAA-MM-DD`. */
  fecha: string;
}

/** Un vendedor, o una sucursal por codigo (`null` = todas). */
export type FiltroMovimientos =
  { vendedorId: string } | { sucursalCodigo: string | null };

/**
 * Las lineas **aceptadas** de las cargas aceptadas y vivas de ese dia
 * (pendientes, rechazadas y dadas de baja no cuentan). Desde la pieza 3 el
 * vendedor acepta por renglon: una carga `aceptada` tiene al menos un renglon
 * aceptado y los que trae `aceptada = false` no cuentan; `null` (una carga
 * aceptada antes de la pieza 3) cuenta como aceptado (`renglonAceptado` de
 * reglas-carga.ts). `carga_detalle` no tiene baja logica: editar una carga
 * reemplaza sus lineas.
 */
function cargasAceptadasDelRango(desde: string, hasta: string, db: Kysely<DB>) {
  return db
    .selectFrom('carga as c')
    .innerJoin('carga_detalle as cd', 'cd.carga_id', 'c.id')
    .select([
      'c.vendedor_id as vendedor_id',
      'cd.presentacion_id as presentacion_id',
      'c.fecha as fecha',
      'cd.piezas as piezas',
    ])
    .where(sql<boolean>`c.fecha between ${desde}::date and ${hasta}::date`)
    .where('c.estado', '=', 'aceptada')
    .where(sql<boolean>`coalesce(cd.aceptada, true)`)
    .where('c.deleted_at', 'is', null);
}

/**
 * Por vendedor y presentacion, lo cargado (cargas aceptadas), lo vendido y
 * regalado (lineas vivas de ventas vivas con esa `fecha`, de cualquier status;
 * las de mostrador no tienen vendedor y no cuentan), la merma y el consumo de
 * la tablet (`movimiento_inventario` vivo de esa `fecha`: merma del cliente
 * entregada/recibida, merma del trayecto, consumo y cambio fisico
 * entregado/recibido de la tablet), los procesos de la oficina
 * con vendedor (`proceso_oficina` vivo: merma de cliente y de almacen, cambios,
 * consumo y promocion; el descuento no cuenta) y lo contado (filas vivas de
 * `retorno`). Solo salen las
 * presentaciones con algun movimiento, aunque esten desactivadas o dadas de baja. Vendidas se leen en vivo: editar o
 * eliminar una venta (T-17) cambia el teorico.
 *
 * `filtro`: un vendedor, o una sucursal por codigo (`null` = todas). Siempre
 * vendedores vivos; la sucursal es la del vendedor.
 *
 * Fuera de la clase a proposito: la venta del portal (`ventas-cobranza/`) la
 * llama con su `trx` para calcular la existencia del vendedor con
 * `existenciasPorPresentacion` (reglas-corte.ts). Una sola cuenta para el corte
 * y para el candado de la venta.
 */
export async function movimientosDelDia(
  db: Kysely<DB>,
  fecha: string,
  filtro: FiltroMovimientos,
): Promise<MovimientoVendedor[]> {
  const filas = await movimientosDelRango(db, fecha, fecha, filtro);
  // Sin `fecha` ni `sucursalId`: la forma de siempre del corte.
  return filas.map((f) => {
    const m: Partial<MovimientoVendedorDia> = { ...f };
    delete m.fecha;
    delete m.sucursalId;
    return m as MovimientoVendedor;
  });
}

/** Un `MovimientoVendedor` de un dia del rango, con la sucursal del vendedor. */
export interface MovimientoVendedorDia extends MovimientoVendedor {
  /** `AAAA-MM-DD`. */
  fecha: string;
  sucursalId: string;
}

/**
 * `movimientosDelDia` para un rango de fechas (`desde` y `hasta` incluidos), en
 * una sola consulta agrupada por dia: la misma cuenta, una fila por vendedor,
 * presentacion y dia. La usa el Inventario de PT para la merma de los
 * vendedores (contada o teorica) sin un query por dia.
 */
export async function movimientosDelRango(
  db: Kysely<DB>,
  desde: string,
  hasta: string,
  filtro: FiltroMovimientos,
  opciones: { incluirDadosDeBaja?: boolean } = {},
): Promise<MovimientoVendedorDia[]> {
  // Solo el Inventario de PT incluye a los vendedores dados de baja: darlos de
  // baja no debe reescribir la historia del inventario. El corte, Inventario
  // por vendedor y el candado de la venta siguen viendo solo a los vivos.
  const vendedorVivo = opciones.incluirDadosDeBaja
    ? sql`true`
    : sql`v.deleted_at is null`;
  const condicion =
    'vendedorId' in filtro
      ? sql`v.id = ${filtro.vendedorId}`
      : filtro.sucursalCodigo === null
        ? sql`true`
        : sql`s.codigo = ${filtro.sucursalCodigo}`;
  const r = await sql<MovimientoVendedorDia>`
    with mov as (
      select cg.vendedor_id, cg.presentacion_id, cg.fecha,
             cg.piezas as cargadas, 0 as vendidas, 0 as regaladas, 0 as buenas, 0 as merma,
             0 as merma_entregada, 0 as merma_recibida, 0 as merma_almacen, 0 as consumo,
             0 as cambios_entregados, 0 as cambios_recibidos
        from (${cargasAceptadasDelRango(desde, hasta, db)}) cg
      union all
      select vn.vendedor_id, d.presentacion_id, vn.fecha,
             0, d.cantidad, d.cantidad_promocion, 0, 0,
             0, 0, 0, 0,
             0, 0
        from venta_nota vn
        join venta_nota_detalle d on d.venta_nota_id = vn.id
       where vn.fecha between ${desde}::date and ${hasta}::date
         and vn.vendedor_id is not null
         and vn.deleted_at is null
         and d.deleted_at is null
      union all
      select rt.vendedor_id, rt.presentacion_id, rt.fecha,
             0, 0, 0, rt.piezas, rt.piezas_merma,
             0, 0, 0, 0,
             0, 0
        from retorno rt
       where rt.fecha between ${desde}::date and ${hasta}::date
         and rt.deleted_at is null
      union all
      select mi.vendedor_id, l.presentacion_id, mi.fecha,
             0, 0, 0, 0, 0,
             case when mi.tipo = 'merma_cliente' and l.sentido = 'entregado' then l.piezas else 0 end,
             case when mi.tipo = 'merma_cliente' and l.sentido = 'recibido' then l.piezas else 0 end,
             case when mi.tipo = 'merma_trayecto' then l.piezas else 0 end,
             case when mi.tipo = 'consumo' then l.piezas else 0 end,
             case when mi.tipo = 'cambio' and l.sentido = 'entregado' then l.piezas else 0 end,
             case when mi.tipo = 'cambio' and l.sentido = 'recibido' then l.piezas else 0 end
        from movimiento_inventario mi
        join movimiento_inventario_linea l on l.movimiento_id = mi.id
       where mi.fecha between ${desde}::date and ${hasta}::date
         and mi.deleted_at is null
      union all
      -- Procesos de la oficina con vendedor (Operacion -> Procesos, D4). Sin
      -- vendedor son de Oficina y no tocan ninguna camioneta; el descuento es
      -- la consecuencia del faltante y no mueve la cuenta.
      select po.vendedor_id, l.presentacion_id, po.fecha,
             0, 0,
             case when po.tipo = 'promocion' then l.piezas else 0 end,
             0, 0,
             case when po.tipo = 'merma' and po.merma_de = 'cliente' and l.sentido = 'entregado' then l.piezas else 0 end,
             case when po.tipo = 'merma' and po.merma_de = 'cliente' and l.sentido = 'recibido' then l.piezas else 0 end,
             case when po.tipo = 'merma' and po.merma_de = 'almacen' then l.piezas else 0 end,
             case when po.tipo = 'consumo' then l.piezas else 0 end,
             case when po.tipo = 'cambio' and l.sentido = 'entregado' then l.piezas else 0 end,
             case when po.tipo = 'cambio' and l.sentido = 'recibido' then l.piezas else 0 end
        from proceso_oficina po
        join proceso_oficina_linea l on l.proceso_id = po.id
       where po.fecha between ${desde}::date and ${hasta}::date
         and po.deleted_at is null
         and po.vendedor_id is not null
         and po.tipo <> 'descuento'
    )
    select m.vendedor_id as "vendedorId",
           to_char(m.fecha, 'YYYY-MM-DD') as fecha,
           v.sucursal_id as "sucursalId",
           m.presentacion_id as "presentacionId",
           p.nombre || ' ' || pr.volumen as nombre,
           p.nombre as producto,
           pr.volumen as volumen,
           sum(m.cargadas)::int as cargadas,
           sum(m.vendidas)::int as vendidas,
           sum(m.regaladas)::int as regaladas,
           sum(m.merma_entregada)::int as "mermaEntregada",
           sum(m.merma_recibida)::int as "mermaRecibida",
           sum(m.merma_almacen)::int as "mermaAlmacen",
           sum(m.consumo)::int as consumo,
           sum(m.cambios_entregados)::int as "cambiosEntregados",
           sum(m.cambios_recibidos)::int as "cambiosRecibidos",
           sum(m.buenas)::int as buenas,
           sum(m.merma)::int as merma
      from mov m
      join vendedor v on v.id = m.vendedor_id
      join sucursal s on s.id = v.sucursal_id
      join presentacion pr on pr.id = m.presentacion_id
      join producto p on p.id = pr.producto_id
     where ${vendedorVivo}
       and ${condicion}
     group by m.vendedor_id, m.fecha, v.sucursal_id, m.presentacion_id, p.nombre, pr.volumen
     order by m.fecha, p.nombre, pr.volumen, m.presentacion_id
  `.execute(db);
  return r.rows;
}

/** Una linea de una carga viva del dia, en cualquier estado (Recargas de Inventario por vendedor). */
export interface RecargaDelDia {
  cargaId: string;
  numero: number;
  vendedorId: string;
  vendedor: string;
  presentacionId: string;
  nombre: string;
  producto: string;
  volumen: string;
  piezas: number;
  capturo: string;
  /** `HH24:MI` de Tijuana, de `created_at`. */
  hora: string;
  estado: 'pendiente' | 'aceptada' | 'rechazada';
  motivoRechazo: string | null;
  /**
   * ¿Este renglon se acepto? `null` mientras la carga esta pendiente; en una
   * carga respondida antes de la pieza 3 (renglon sin respuesta), lo que diga la
   * carga (`renglonAceptado`).
   */
  aceptada: boolean | null;
  /** Renglones aceptados de la carga; `null` mientras esta pendiente. */
  renglonesAceptados: number | null;
  /** Renglones de la carga ("Aceptada 2 de 3"). */
  renglones: number;
}

/**
 * SQL del corte de mercancia. Los metodos que escriben reciben la `trx` del
 * servicio; ninguno abre la suya. Cargas y ventas solo se leen.
 */
@Injectable()
export class CortesRepository {
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

  async vendedor(
    id: string,
    db: Kysely<DB> = this.db,
  ): Promise<VendedorCorte | undefined> {
    return db
      .selectFrom('vendedor')
      .innerJoin('sucursal', 'sucursal.id', 'vendedor.sucursal_id')
      .select([
        'vendedor.id as id',
        'vendedor.nombre as nombre',
        'vendedor.sucursal_id as sucursalId',
        'sucursal.codigo as sucursalCodigo',
      ])
      .where('vendedor.id', '=', id)
      .where('vendedor.deleted_at', 'is', null)
      .executeTakeFirst();
  }

  /**
   * Bloquea la fila del vendedor hasta el fin de la transaccion: dos guardados
   * del mismo vendedor y dia se aplican uno despues del otro, tambien el primero
   * (cuando aun no hay encabezado ni filas de `retorno` que bloquear).
   * `for no key update` no frena los inserts que solo lo referencian. El
   * candado va sobre `vendedor` sola: con un join bloquearia la sucursal.
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

  /** Las filas vivas de `retorno` del dia, bloqueadas, ya con el vendedor bloqueado. */
  async bloquearVivas(
    dia: DiaVendedor,
    trx: Transaction<DB>,
  ): Promise<ConteoVivo[]> {
    return trx
      .selectFrom('retorno')
      .select([
        'id',
        'presentacion_id as presentacionId',
        'piezas as buenas',
        'piezas_merma as merma',
      ])
      .where('vendedor_id', '=', dia.vendedorId)
      .where(sql<boolean>`fecha = ${dia.fecha}::date`)
      .where('deleted_at', 'is', null)
      .forUpdate()
      .execute();
  }

  /** De esos ids, las presentaciones vivas de un producto vivo (activo o no). */
  async idsVivos(
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
    dia: DiaVendedor,
    sucursalId: string,
    lineas: readonly ConteoPedido[],
    usuarioId: string,
    trx: Transaction<DB>,
  ): Promise<void> {
    if (lineas.length === 0) return;
    await trx
      .insertInto('retorno')
      .values(
        lineas.map((l) => ({
          fecha: sql<Date>`${dia.fecha}::date`,
          vendedor_id: dia.vendedorId,
          sucursal_id: sucursalId,
          presentacion_id: l.presentacionId,
          piezas: l.buenas,
          piezas_merma: l.merma,
          capturo_usuario_id: usuarioId,
        })),
      )
      .execute();
  }

  async actualizar(
    cambios: readonly { id: string; buenas: number; merma: number }[],
    usuarioId: string,
    trx: Transaction<DB>,
  ): Promise<void> {
    for (const c of cambios) {
      await trx
        .updateTable('retorno')
        .set({
          piezas: c.buenas,
          piezas_merma: c.merma,
          actualizado_por_usuario_id: usuarioId,
        })
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
      .updateTable('retorno')
      .set({ deleted_at: sql`now()`, actualizado_por_usuario_id: usuarioId })
      .where('id', 'in', [...ids])
      .execute();
  }

  /**
   * Deja el corte hecho: crea el encabezado al primer guardado y en los
   * siguientes solo anota quien lo corrigio (el trigger mueve `updated_at`).
   * Con el vendedor bloqueado nadie mas escribe este encabezado.
   */
  async marcarHecho(
    dia: DiaVendedor,
    sucursalId: string,
    usuarioId: string,
    trx: Transaction<DB>,
  ): Promise<void> {
    const actualizado = await trx
      .updateTable('corte_mercancia')
      .set({ actualizado_por_usuario_id: usuarioId })
      .where('vendedor_id', '=', dia.vendedorId)
      .where(sql<boolean>`fecha = ${dia.fecha}::date`)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (Number(actualizado.numUpdatedRows) > 0) return;
    await trx
      .insertInto('corte_mercancia')
      .values({
        fecha: sql<Date>`${dia.fecha}::date`,
        vendedor_id: dia.vendedorId,
        sucursal_id: sucursalId,
        hecho_por_usuario_id: usuarioId,
      })
      .execute();
  }

  /** El encabezado vivo del corte de ese dia, o `undefined` si no se ha hecho. */
  async encabezado(
    dia: DiaVendedor,
    db: Kysely<DB> = this.db,
  ): Promise<EncabezadoCorte | undefined> {
    return db
      .selectFrom('corte_mercancia as cm')
      .innerJoin('usuario as u', 'u.id', 'cm.hecho_por_usuario_id')
      .select([
        // Hora de Tijuana ya formateada: el portal no adivina la zona (lib/formato.ts).
        sql<string>`to_char(cm.hecho_en at time zone 'America/Tijuana', 'YYYY-MM-DD HH24:MI')`.as(
          'hechoEn',
        ),
        'u.nombre as hechoPor',
      ])
      .where('cm.vendedor_id', '=', dia.vendedorId)
      .where(sql<boolean>`cm.fecha = ${dia.fecha}::date`)
      .where('cm.deleted_at', 'is', null)
      .executeTakeFirst();
  }

  /** Ver `movimientosDelDia`: la consulta vive fuera de la clase para que la venta del portal la reutilice. */
  movimientos(
    fecha: string,
    filtro: FiltroMovimientos,
    db: Kysely<DB> = this.db,
  ): Promise<MovimientoVendedor[]> {
    return movimientosDelDia(db, fecha, filtro);
  }

  /**
   * Los vendedores vivos de la lista del dia (D11): los que tienen movimientos
   * (`conMovimiento`) o un corte vivo ese dia. Orden sucursal, nombre.
   */
  async vendedoresDelDia(
    fecha: string,
    sucursalCodigo: string | null,
    conMovimiento: readonly string[],
  ): Promise<VendedorDelDia[]> {
    return this.db
      .selectFrom('vendedor as v')
      .innerJoin('sucursal as s', 's.id', 'v.sucursal_id')
      .leftJoin('corte_mercancia as cm', (join) =>
        join
          .onRef('cm.vendedor_id', '=', 'v.id')
          .on(sql<boolean>`cm.fecha = ${fecha}::date`)
          .on('cm.deleted_at', 'is', null),
      )
      .select([
        'v.id as id',
        'v.nombre as nombre',
        's.id as sucursalId',
        's.codigo as sucursalCodigo',
        sql<string>`to_char(cm.hecho_en at time zone 'America/Tijuana', 'YYYY-MM-DD HH24:MI')`.as(
          'hechoEn',
        ),
      ])
      .where('v.deleted_at', 'is', null)
      .$if(sucursalCodigo !== null, (qb) =>
        qb.where('s.codigo', '=', sucursalCodigo as string),
      )
      .where((eb) =>
        conMovimiento.length === 0
          ? eb('cm.id', 'is not', null)
          : eb.or([
              eb('cm.id', 'is not', null),
              eb('v.id', 'in', [...conMovimiento]),
            ]),
      )
      .orderBy('s.codigo')
      .orderBy('v.nombre')
      .orderBy('v.id')
      .execute();
  }

  /** La sucursal por codigo, o `undefined` si no existe. */
  async sucursalPorCodigo(
    codigo: string,
  ): Promise<{ id: string; codigo: string } | undefined> {
    return this.db
      .selectFrom('sucursal')
      .select(['id', 'codigo'])
      .where('codigo', '=', codigo)
      .executeTakeFirst();
  }

  /**
   * Una fila por linea de carga viva de ese dia (pendiente, aceptada o
   * rechazada) de un vendedor o de toda una sucursal; vendedores vivos, con si
   * el renglon se acepto y cuantos de la carga ("Aceptada 2 de 3"). Orden:
   * hora, vendedor, producto.
   */
  async recargas(
    fecha: string,
    filtro: { vendedorId: string } | { sucursalCodigo: string },
  ): Promise<RecargaDelDia[]> {
    const condicion =
      'vendedorId' in filtro
        ? sql`v.id = ${filtro.vendedorId}`
        : sql`s.codigo = ${filtro.sucursalCodigo}`;
    const r = await sql<RecargaDelDia>`
      select c.id as "cargaId",
             c.numero as numero,
             v.id as "vendedorId",
             v.nombre as vendedor,
             cd.presentacion_id as "presentacionId",
             p.nombre || ' ' || pr.volumen as nombre,
             p.nombre as producto,
             pr.volumen as volumen,
             cd.piezas as piezas,
             u.nombre as capturo,
             to_char(c.created_at at time zone 'America/Tijuana', 'HH24:MI') as hora,
             c.estado as estado,
             c.motivo_rechazo as "motivoRechazo",
             case when c.estado = 'pendiente' then null
                  else coalesce(cd.aceptada, c.estado = 'aceptada') end as aceptada,
             case when c.estado = 'pendiente' then null
                  else (count(*) filter (
                          where coalesce(cd.aceptada, c.estado = 'aceptada')
                        ) over (partition by c.id))::int end as "renglonesAceptados",
             (count(*) over (partition by c.id))::int as renglones
        from carga c
        join carga_detalle cd on cd.carga_id = c.id
        join vendedor v on v.id = c.vendedor_id
        join sucursal s on s.id = v.sucursal_id
        join presentacion pr on pr.id = cd.presentacion_id
        join producto p on p.id = pr.producto_id
        join usuario u on u.id = c.capturo_usuario_id
       where c.fecha = ${fecha}::date
         and c.deleted_at is null
         and v.deleted_at is null
         and ${condicion}
       order by c.created_at, v.nombre, p.nombre, pr.volumen, c.id, cd.id
    `.execute(this.db);
    return r.rows;
  }
}
