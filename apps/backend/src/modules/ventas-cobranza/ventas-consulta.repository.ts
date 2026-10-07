import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DB_CONNECTION, type Database } from '../../database/database.tokens';
import { aCentavos } from '../sincronizacion/dinero';
import { saldoDerivadoCentavos } from './reglas-cobranza';
import type { ContadoCredito } from './reglas-venta';
import type { OrigenVenta } from './ventas.service';

/** Ya resuelto por el servicio: fechas validas y alcance aplicado. */
export interface FiltroBusquedaVentas {
  desde: string;
  hasta: string;
  /** `null` = todas las sucursales (usuario General sin filtro). */
  sucursalCodigo: string | null;
  clienteId: string | null;
  numNota: string | null;
}

/** Una fila de la tabla de resultados (§3.1). */
export interface VentaEncontrada {
  id: string;
  folio: string;
  /** `AAAA-MM-DD`. */
  fecha: string;
  clienteId: string;
  cliente: string;
  /** Nombre del vendedor; `null` = Oficina. */
  repartidor: string | null;
  /** `null` si no hubo nota de papel. */
  numNota: string | null;
  montoCentavos: number;
  status: string;
  origen: OrigenVenta;
  /** Monto menos abonos vivos (D7 de T-20), nunca negativo. */
  saldoCentavos: number;
}

export interface CabeceraVenta {
  id: string;
  folio: string;
  fecha: string;
  clienteId: string;
  cliente: string;
  sucursalId: string;
  sucursalCodigo: string;
  vendedorId: string | null;
  repartidor: string | null;
  numNota: string | null;
  contadoCredito: ContadoCredito;
  factura: string;
  /** El numero cuando `factura = 'facturada'` (T-19). */
  facturaNumero: string | null;
  comentarios: string | null;
  montoCentavos: number;
  status: string;
  origen: OrigenVenta;
}

export interface LineaDeVenta {
  presentacionId: string;
  producto: string;
  volumen: string;
  cantidad: number;
  cantidadPromocion: number;
  /** El guardado: el de la nota firmada (tablet) o el de la lista a la fecha (portal). */
  precioCentavos: number;
}

export interface CobroDeVenta {
  id: string;
  fechaPago: string;
  metodoPago: string;
  montoCentavos: number;
  origen: 'cobro' | 'venta_contado';
}

/**
 * Lecturas de la busqueda y el detalle de ventas del portal (T-17 parte 2).
 *
 * Solo ventas VIVAS: una eliminada no sale en la busqueda y su detalle es 404.
 * Las fechas salen con `to_char`: un `date` leido como `Date` se corre un dia
 * segun el huso del proceso.
 */
@Injectable()
export class VentasConsultaRepository {
  constructor(@Inject(DB_CONNECTION) private readonly db: Database) {}

  /**
   * Por fecha descendente y luego folio. `limite` lo fija el servicio (tope + 1,
   * para saber si hay mas).
   *
   * El # de nota se compara como lo compara el indice unico de #95
   * (`lower(btrim(...))`): "buscar la 1234" encuentra exactamente la nota que
   * el indice no deja repetir. Coincidencia exacta, no parcial.
   */
  async buscar(
    filtro: FiltroBusquedaVentas,
    limite: number,
  ): Promise<VentaEncontrada[]> {
    const condiciones = [
      sql`vn.deleted_at is null`,
      sql`vn.fecha between ${filtro.desde}::date and ${filtro.hasta}::date`,
    ];
    if (filtro.sucursalCodigo !== null)
      condiciones.push(sql`s.codigo = ${filtro.sucursalCodigo}`);
    if (filtro.clienteId !== null)
      condiciones.push(sql`vn.cliente_id = ${filtro.clienteId}::uuid`);
    if (filtro.numNota !== null)
      condiciones.push(
        sql`lower(btrim(vn.num_nota)) = lower(btrim(${filtro.numNota}))`,
      );

    const filas = await sql<{
      id: string;
      folio: string;
      fecha: string;
      cliente_id: string;
      cliente: string;
      repartidor: string | null;
      num_nota: string | null;
      monto_total: string;
      status: string;
      origen: string;
      abonado: string;
    }>`
      select vn.id, vn.folio, to_char(vn.fecha, 'YYYY-MM-DD') as fecha,
             vn.cliente_id, c.nombre as cliente, v.nombre as repartidor,
             vn.num_nota, vn.monto_total, vn.status, vn.origen,
             coalesce(a.abonado, 0)::text as abonado
        from venta_nota vn
        join cliente c on c.id = vn.cliente_id
        join sucursal s on s.id = vn.sucursal_id
        left join vendedor v on v.id = vn.vendedor_id
        left join lateral (
          select sum(ca.monto) as abonado
            from cobranza_abono ca
           where ca.venta_nota_id = vn.id
             and ca.deleted_at is null
        ) a on true
       where ${sql.join(condiciones, sql` and `)}
       order by vn.fecha desc, vn.folio
       limit ${limite}
    `.execute(this.db);

    return filas.rows.map((f) => ({
      id: f.id,
      folio: f.folio,
      fecha: f.fecha,
      clienteId: f.cliente_id,
      cliente: f.cliente,
      repartidor: f.repartidor,
      numNota: f.num_nota,
      montoCentavos: aCentavos(f.monto_total),
      status: f.status,
      origen: f.origen as OrigenVenta,
      saldoCentavos: saldoDerivadoCentavos(
        aCentavos(f.monto_total),
        aCentavos(f.abonado),
      ),
    }));
  }

  /** La cabecera de una venta VIVA, o `undefined`. */
  async cabecera(id: string): Promise<CabeceraVenta | undefined> {
    const filas = await sql<{
      id: string;
      folio: string;
      fecha: string;
      cliente_id: string;
      cliente: string;
      sucursal_id: string;
      sucursal_codigo: string;
      vendedor_id: string | null;
      repartidor: string | null;
      num_nota: string | null;
      contado_credito: string;
      factura: string;
      factura_numero: string | null;
      comentarios: string | null;
      monto_total: string;
      status: string;
      origen: string;
    }>`
      select vn.id, vn.folio, to_char(vn.fecha, 'YYYY-MM-DD') as fecha,
             vn.cliente_id, c.nombre as cliente, vn.sucursal_id,
             s.codigo as sucursal_codigo, vn.vendedor_id,
             v.nombre as repartidor, vn.num_nota, vn.contado_credito,
             vn.factura, f.numero as factura_numero, vn.comentarios,
             vn.monto_total, vn.status, vn.origen
        from venta_nota vn
        join cliente c on c.id = vn.cliente_id
        join sucursal s on s.id = vn.sucursal_id
        left join vendedor v on v.id = vn.vendedor_id
        left join factura f on f.id = vn.factura_id
       where vn.id = ${id}
         and vn.deleted_at is null
    `.execute(this.db);

    const f = filas.rows[0];
    if (!f) return undefined;
    return {
      id: f.id,
      folio: f.folio,
      fecha: f.fecha,
      clienteId: f.cliente_id,
      cliente: f.cliente,
      sucursalId: f.sucursal_id,
      sucursalCodigo: f.sucursal_codigo,
      vendedorId: f.vendedor_id,
      repartidor: f.repartidor,
      numNota: f.num_nota,
      contadoCredito: f.contado_credito as ContadoCredito,
      factura: f.factura,
      facturaNumero: f.factura_numero,
      comentarios: f.comentarios,
      montoCentavos: aCentavos(f.monto_total),
      status: f.status,
      origen: f.origen as OrigenVenta,
    };
  }

  /** Lineas vivas, por producto y volumen. */
  async lineas(id: string): Promise<LineaDeVenta[]> {
    const filas = await this.db
      .selectFrom('venta_nota_detalle as d')
      .innerJoin('presentacion as pr', 'pr.id', 'd.presentacion_id')
      .innerJoin('producto as p', 'p.id', 'pr.producto_id')
      .select([
        'd.presentacion_id',
        'p.nombre as producto',
        'pr.volumen',
        'd.cantidad',
        'd.cantidad_promocion',
        'd.precio',
      ])
      .where('d.venta_nota_id', '=', id)
      .where('d.deleted_at', 'is', null)
      .orderBy('p.nombre')
      .orderBy('pr.volumen')
      .execute();
    return filas.map((f) => ({
      presentacionId: f.presentacion_id,
      producto: f.producto,
      volumen: f.volumen,
      cantidad: f.cantidad,
      cantidadPromocion: f.cantidad_promocion,
      precioCentavos: aCentavos(f.precio),
    }));
  }

  /** Abonos vivos (el cobro de contado y los de cobranza), por fecha de pago. */
  async cobros(id: string): Promise<CobroDeVenta[]> {
    const filas = await sql<{
      id: string;
      fecha_pago: string;
      metodo_pago: string;
      monto: string;
      origen: string;
    }>`
      select id, to_char(fecha_pago, 'YYYY-MM-DD') as fecha_pago,
             metodo_pago, monto, origen
        from cobranza_abono
       where venta_nota_id = ${id}
         and deleted_at is null
       order by fecha_pago, created_at
    `.execute(this.db);
    return filas.rows.map((f) => ({
      id: f.id,
      fechaPago: f.fecha_pago,
      metodoPago: f.metodo_pago,
      montoCentavos: aCentavos(f.monto),
      origen: f.origen as CobroDeVenta['origen'],
    }));
  }
}
