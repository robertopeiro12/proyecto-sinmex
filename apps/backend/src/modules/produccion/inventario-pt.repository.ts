import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DB_CONNECTION, type Database } from '../../database/database.tokens';
import {
  movimientosDelRango,
  type MovimientoVendedorDia,
} from './cortes.repository';
import type { AjustePedido, MovimientosDia } from './reglas-inventario-pt';

/** Una presentacion de la pantalla, con su producto. */
export interface PresentacionPt {
  presentacionId: string;
  productoId: string;
  producto: string;
  volumen: string;
  /** Presentacion y producto sin baja logica. */
  viva: boolean;
}

/** Los movimientos de una presentacion en una sucursal y un dia. */
export interface MovimientosSucursalDia extends MovimientosDia {
  sucursalId: string;
  presentacionId: string;
  /** `AAAA-MM-DD`. */
  fecha: string;
}

/** Un ajuste vivo, con su sucursal y presentacion. */
export interface AjusteFila {
  sucursalId: string;
  presentacionId: string;
  fecha: string;
  inventarioInicial: number;
  mermaAcumuladaInicial: number;
}

/** Una fila de "a quien" de los descuentos. */
export interface DescuentoFila {
  quien: string;
  origen: 'corte' | 'nomina';
  piezas: number;
}

const idsComoArreglo = (ids: readonly string[]) =>
  sql`array[${sql.join([...ids])}]::uuid[]`;

/**
 * SQL del Inventario de PT con Ventas. Todo vivo (`deleted_at is null` en
 * encabezados y en las lineas que lo tienen); las consultas son por rango y
 * agrupadas por dia, nunca un query por dia. La merma de los vendedores sale
 * de `movimientosDelRango` (la misma cuenta del corte).
 */
@Injectable()
export class InventarioPtRepository {
  constructor(@Inject(DB_CONNECTION) private readonly db: Database) {}

  /** Las sucursales sin baja logica (Todas = la suma de estas). */
  sucursalesVivas(): Promise<{ id: string; codigo: string }[]> {
    return this.db
      .selectFrom('sucursal')
      .select(['id', 'codigo'])
      .where('deleted_at', 'is', null)
      .orderBy('codigo')
      .execute();
  }

  /**
   * Las presentaciones vivas (de un producto vivo) mas las de `extra`, aunque
   * esten dadas de baja; con `productoId`, solo las de ese producto.
   */
  async presentaciones(
    extra: readonly string[],
    productoId?: string,
  ): Promise<PresentacionPt[]> {
    const r = await sql<PresentacionPt>`
      select pr.id as "presentacionId",
             p.id as "productoId",
             p.nombre as producto,
             pr.volumen as volumen,
             (pr.deleted_at is null and p.deleted_at is null) as viva
        from presentacion pr
        join producto p on p.id = pr.producto_id
       where ((pr.deleted_at is null and p.deleted_at is null)
              ${extra.length > 0 ? sql`or pr.id = any(${idsComoArreglo(extra)})` : sql``})
         ${productoId ? sql`and p.id = ${productoId}` : sql``}
       order by p.nombre, pr.volumen, pr.id
    `.execute(this.db);
    return r.rows;
  }

  /** Una presentacion (viva o no), o `undefined` si no existe. */
  async presentacion(id: string): Promise<PresentacionPt | undefined> {
    const r = await sql<PresentacionPt>`
      select pr.id as "presentacionId", p.id as "productoId", p.nombre as producto,
             pr.volumen as volumen,
             (pr.deleted_at is null and p.deleted_at is null) as viva
        from presentacion pr
        join producto p on p.id = pr.producto_id
       where pr.id = ${id}
    `.execute(this.db);
    return r.rows[0];
  }

  /** Todas las presentaciones de un producto (vivas o no). `[]` si el producto no existe. */
  async presentacionesDeProducto(
    productoId: string,
  ): Promise<PresentacionPt[]> {
    const r = await sql<PresentacionPt>`
      select pr.id as "presentacionId", p.id as "productoId", p.nombre as producto,
             pr.volumen as volumen,
             (pr.deleted_at is null and p.deleted_at is null) as viva
        from presentacion pr
        join producto p on p.id = pr.producto_id
       where p.id = ${productoId}
       order by pr.volumen, pr.id
    `.execute(this.db);
    return r.rows;
  }

  /**
   * Los ajustes vivos que hacen falta para encadenar `[desde, hasta]`: por
   * sucursal y presentacion, el mas reciente <= `desde` y todos los de
   * `(desde, hasta]`.
   */
  async ajustes(
    sucursalIds: readonly string[],
    desde: string,
    hasta: string,
    presentacionIds: readonly string[] | null,
  ): Promise<AjusteFila[]> {
    if (sucursalIds.length === 0) return [];
    const r = await sql<AjusteFila>`
      select a.sucursal_id as "sucursalId",
             a.presentacion_id as "presentacionId",
             to_char(a.fecha, 'YYYY-MM-DD') as fecha,
             a.inventario_inicial as "inventarioInicial",
             a.merma_acumulada_inicial as "mermaAcumuladaInicial"
        from inventario_pt_ajuste a
       where a.deleted_at is null
         and a.sucursal_id = any(${idsComoArreglo(sucursalIds)})
         ${presentacionIds ? sql`and a.presentacion_id = any(${idsComoArreglo(presentacionIds)})` : sql``}
         and a.fecha <= ${hasta}::date
         and a.fecha >= coalesce(
               (select max(b.fecha) from inventario_pt_ajuste b
                 where b.deleted_at is null
                   and b.sucursal_id = a.sucursal_id
                   and b.presentacion_id = a.presentacion_id
                   and b.fecha <= ${desde}::date),
               ${desde}::date)
       order by a.fecha
    `.execute(this.db);
    return r.rows;
  }

  /**
   * Todo lo que no es merma de vendedores (D2), por sucursal, presentacion y
   * dia, en una sola consulta: ventas y promo de las ventas vivas de la
   * sucursal; Registro de Operacion (entrada, envio que sale y que llega,
   * merma, consumo, descuento, retiro de merma autorizado); Procesos (merma
   * recibida solo de Oficina, consumo, promocion, descuento, cambios netos) y
   * el consumo de la app (sucursal del vendedor).
   */
  async movimientos(
    sucursalIds: readonly string[],
    desde: string,
    hasta: string,
    presentacionIds: readonly string[] | null,
  ): Promise<MovimientosSucursalDia[]> {
    if (sucursalIds.length === 0) return [];
    const suc = idsComoArreglo(sucursalIds);
    const rango = (col: string) =>
      sql`${sql.ref(col)} between ${desde}::date and ${hasta}::date`;
    const pres = (col: string) =>
      presentacionIds
        ? sql`and ${sql.ref(col)} = any(${idsComoArreglo(presentacionIds)})`
        : sql``;
    const r = await sql<MovimientosSucursalDia>`
      with mov as (
        select vn.sucursal_id, d.presentacion_id, vn.fecha,
               d.cantidad as ventas, 0 as merma, 0 as consumo,
               d.cantidad_promocion as promo, 0 as descuentos, 0 as cambios,
               0 as entradas, 0 as envios, 0 as retiro
          from venta_nota vn
          join venta_nota_detalle d on d.venta_nota_id = vn.id
         where vn.deleted_at is null and d.deleted_at is null
           and vn.sucursal_id = any(${suc})
           and ${rango('vn.fecha')} ${pres('d.presentacion_id')}
        union all
        select oa.sucursal_id, l.presentacion_id, oa.fecha,
               0,
               case when oa.tipo = 'merma' then l.piezas else 0 end,
               case when oa.tipo = 'consumo' then l.piezas else 0 end,
               0,
               case when oa.tipo = 'descuento' then l.piezas else 0 end,
               0,
               case when oa.tipo = 'entrada' then l.piezas else 0 end,
               case when oa.tipo = 'envio' then l.piezas else 0 end,
               case when oa.tipo = 'retiro_merma' and oa.estado = 'autorizado' then l.piezas else 0 end
          from operacion_almacen oa
          join operacion_almacen_linea l on l.operacion_id = oa.id
         where oa.deleted_at is null
           and oa.sucursal_id = any(${suc})
           and ${rango('oa.fecha')} ${pres('l.presentacion_id')}
        union all
        -- Envios recibidos: entran como Entrada en el destino.
        select oa.sucursal_destino_id, l.presentacion_id, oa.fecha,
               0, 0, 0, 0, 0, 0, l.piezas, 0, 0
          from operacion_almacen oa
          join operacion_almacen_linea l on l.operacion_id = oa.id
         where oa.deleted_at is null
           and oa.tipo = 'envio'
           and oa.sucursal_destino_id = any(${suc})
           and ${rango('oa.fecha')} ${pres('l.presentacion_id')}
        union all
        -- Procesos: la merma con vendedor ya va en su corte; aqui solo Oficina.
        select po.sucursal_id, l.presentacion_id, po.fecha,
               0,
               case when po.tipo = 'merma' and po.vendedor_id is null and l.sentido = 'recibido' then l.piezas else 0 end,
               case when po.tipo = 'consumo' then l.piezas else 0 end,
               case when po.tipo = 'promocion' then l.piezas else 0 end,
               case when po.tipo = 'descuento' then l.piezas else 0 end,
               case when po.tipo = 'cambio' and l.sentido = 'recibido' then l.piezas
                    when po.tipo = 'cambio' and l.sentido = 'entregado' then -l.piezas
                    else 0 end,
               0, 0, 0
          from proceso_oficina po
          join proceso_oficina_linea l on l.proceso_id = po.id
         where po.deleted_at is null
           and po.sucursal_id = any(${suc})
           and ${rango('po.fecha')} ${pres('l.presentacion_id')}
        union all
        -- Consumo propio de la app, en la sucursal del vendedor.
        select v.sucursal_id, l.presentacion_id, mi.fecha,
               0, 0, l.piezas, 0, 0, 0, 0, 0, 0
          from movimiento_inventario mi
          join movimiento_inventario_linea l on l.movimiento_id = mi.id
          join vendedor v on v.id = mi.vendedor_id
         where mi.deleted_at is null
           and mi.tipo = 'consumo'
           and v.sucursal_id = any(${suc})
           and ${rango('mi.fecha')} ${pres('l.presentacion_id')}
      )
      select sucursal_id as "sucursalId",
             presentacion_id as "presentacionId",
             to_char(fecha, 'YYYY-MM-DD') as fecha,
             sum(ventas)::int as ventas,
             sum(merma)::int as merma,
             sum(consumo)::int as consumo,
             sum(promo)::int as promo,
             sum(descuentos)::int as descuentos,
             sum(cambios)::int as cambios,
             sum(entradas)::int as entradas,
             sum(envios)::int as envios,
             sum(retiro)::int as "retiroMerma"
        from mov
       group by sucursal_id, presentacion_id, fecha
    `.execute(this.db);
    return r.rows;
  }

  /**
   * Lo que el corte sabe de los vendedores en el rango (una sucursal por
   * codigo, o todas con `null`): la misma consulta del corte, por dia,
   * incluidos los vendedores dados de baja (su merma pasada sigue contando).
   */
  movimientosVendedores(
    sucursalCodigo: string | null,
    desde: string,
    hasta: string,
  ): Promise<MovimientoVendedorDia[]> {
    return movimientosDelRango(
      this.db,
      desde,
      hasta,
      { sucursalCodigo },
      { incluirDadosDeBaja: true },
    );
  }

  /** Los cortes vivos del rango, como `vendedorId|AAAA-MM-DD`. */
  async cortesHechos(desde: string, hasta: string): Promise<Set<string>> {
    const r = await sql<{ clave: string }>`
      select vendedor_id || '|' || to_char(fecha, 'YYYY-MM-DD') as clave
        from corte_mercancia
       where deleted_at is null
         and fecha between ${desde}::date and ${hasta}::date
    `.execute(this.db);
    return new Set(r.rows.map((f) => f.clave));
  }

  /**
   * "A quien" de los descuentos de esas presentaciones en ese dia: Registro
   * `descuento` = el trabajador (nomina); Procesos `descuento` = el vendedor
   * (faltante del corte). Sumado por nombre y origen.
   */
  async descuentos(
    sucursalIds: readonly string[],
    presentacionIds: readonly string[],
    fecha: string,
  ): Promise<DescuentoFila[]> {
    if (sucursalIds.length === 0 || presentacionIds.length === 0) return [];
    const suc = idsComoArreglo(sucursalIds);
    const pres = idsComoArreglo(presentacionIds);
    const r = await sql<DescuentoFila>`
      with d as (
        select oa.trabajador as quien, 'nomina' as origen, l.piezas
          from operacion_almacen oa
          join operacion_almacen_linea l on l.operacion_id = oa.id
         where oa.deleted_at is null and oa.tipo = 'descuento'
           and oa.sucursal_id = any(${suc})
           and l.presentacion_id = any(${pres})
           and oa.fecha = ${fecha}::date
        union all
        select v.nombre, 'corte', l.piezas
          from proceso_oficina po
          join proceso_oficina_linea l on l.proceso_id = po.id
          join vendedor v on v.id = po.vendedor_id
         where po.deleted_at is null and po.tipo = 'descuento'
           and po.sucursal_id = any(${suc})
           and l.presentacion_id = any(${pres})
           and po.fecha = ${fecha}::date
      )
      select quien, origen, sum(piezas)::int as piezas
        from d
       group by quien, origen
       order by quien, origen
    `.execute(this.db);
    return r.rows;
  }

  /**
   * Guarda los ajustes de un dia en una sucursal, todo o nada: crea el vivo o
   * corrige el que ya hay (el unico parcial decide; dos guardados a la vez no
   * duplican).
   */
  async guardarAjustes(
    sucursalId: string,
    fecha: string,
    renglones: readonly AjustePedido[],
    comentario: string | null,
    usuarioId: string,
  ): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      for (const r of renglones) {
        await trx
          .insertInto('inventario_pt_ajuste')
          .values({
            sucursal_id: sucursalId,
            presentacion_id: r.presentacionId,
            fecha: sql<Date>`${fecha}::date`,
            inventario_inicial: r.inventarioInicial,
            merma_acumulada_inicial: r.mermaAcumuladaInicial,
            comentario,
            capturo_usuario_id: usuarioId,
          })
          .onConflict((oc) =>
            oc
              .columns(['sucursal_id', 'presentacion_id', 'fecha'])
              .where('deleted_at', 'is', null)
              .doUpdateSet({
                inventario_inicial: r.inventarioInicial,
                merma_acumulada_inicial: r.mermaAcumuladaInicial,
                comentario,
                actualizado_por_usuario_id: usuarioId,
              }),
          )
          .execute();
      }
    });
  }

  /** Baja logica del ajuste vivo; `false` si no habia ninguno. */
  async darDeBajaAjuste(
    sucursalId: string,
    presentacionId: string,
    fecha: string,
    usuarioId: string,
  ): Promise<boolean> {
    const r = await this.db
      .updateTable('inventario_pt_ajuste')
      .set({
        deleted_at: sql<Date>`now()`,
        actualizado_por_usuario_id: usuarioId,
      })
      .where('sucursal_id', '=', sucursalId)
      .where('presentacion_id', '=', presentacionId)
      .where(sql<boolean>`fecha = ${fecha}::date`)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    return Number(r.numUpdatedRows) > 0;
  }
}
