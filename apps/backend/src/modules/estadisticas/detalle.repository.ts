import { Inject, Injectable } from '@nestjs/common';
import { sql, type RawBuilder } from 'kysely';
import { DB_CONNECTION, type Database } from '../../database/database.tokens';
import { aCentavos } from '../sincronizacion/dinero';
import type {
  AFavorFila,
  GastoFila,
  LineaFila,
  MetodoPago,
  NotaNoEntregada,
  PagoFila,
  PromoFila,
  VentaFila,
  VisitaSinVentaFila,
} from './reglas-detalle';

/** De un vendedor, o de todos los de una sucursal (por codigo). */
export type AlcanceDetalle =
  { vendedorId: string } | { sucursalCodigo: string };

export interface FilasDetalle {
  ventas: VentaFila[];
  lineas: LineaFila[];
  pagos: PagoFila[];
  aFavor: AFavorFila[];
  gastos: GastoFila[];
  visitasSinVenta: VisitaSinVentaFila[];
  promociones: PromoFila[];
}

// Instante UTC como texto ISO, para no depender de como el driver lee timestamptz.
const iso = (col: string) =>
  sql.raw(
    `to_char(${col} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`,
  );

@Injectable()
export class DetalleRepository {
  constructor(@Inject(DB_CONNECTION) private readonly db: Database) {}

  /** Tambien un vendedor dado de baja: tiene historia en el reporte. */
  async buscarVendedor(id: string) {
    const r = await sql<{ id: string; nombre: string; codigo: string }>`
      select v.id, v.nombre, s.codigo
        from vendedor v join sucursal s on s.id = v.sucursal_id
       where v.id = ${id}::uuid
    `.execute(this.db);
    return r.rows[0] ?? null;
  }

  async existeSucursal(codigo: string): Promise<boolean> {
    const r = await sql`
      select 1 from sucursal where codigo = ${codigo} and deleted_at is null
    `.execute(this.db);
    return r.rows.length > 0;
  }

  async tieneJornada(vendedorId: string, fecha: string): Promise<boolean> {
    const r = await sql`
      select 1 from jornada
       where deleted_at is null and vendedor_id = ${vendedorId}::uuid
         and fecha = ${fecha}::date
    `.execute(this.db);
    return r.rows.length > 0;
  }

  /**
   * Todo en filas planas; las reglas agrupan. Las mismas condiciones de dinero
   * que `FlujoDiarioRepository.filas` (la fila del reporte): contado = abonos
   * vivos `venta_contado` de ventas vivas; anteriores = abonos `cobro` de un
   * cobro vivo del vendedor; a favor = lo que sobra de cada cobro vivo; nunca
   * `saldo_favor`. Para una sucursal se suma ademas la cobranza de la oficina
   * (cobro sin vendedor, por la sucursal del CLIENTE).
   */
  async filas(a: AlcanceDetalle, fecha: string): Promise<FilasDetalle> {
    const cond: RawBuilder<unknown> =
      'vendedorId' in a
        ? sql`v.id = ${a.vendedorId}::uuid`
        : sql`s.codigo = ${a.sucursalCodigo}`;
    const oficina = 'sucursalCodigo' in a ? a.sucursalCodigo : null;

    const [
      ventas,
      lineas,
      contado,
      anteriores,
      aFavor,
      gastos,
      visitas,
      promos,
    ] = await Promise.all([
      this.ventas(cond, fecha),
      this.lineas(cond, fecha),
      this.pagosContado(cond, fecha),
      this.pagosAnteriores(cond, oficina, fecha),
      this.aFavor(cond, oficina, fecha),
      this.gastos(cond, fecha),
      this.visitas(cond, fecha),
      this.promociones(cond, fecha),
    ]);
    return {
      ventas,
      lineas,
      pagos: [...contado, ...anteriores],
      aFavor,
      gastos,
      visitasSinVenta: visitas,
      promociones: promos,
    };
  }

  private async ventas(cond: RawBuilder<unknown>, fecha: string) {
    const r = await sql<{
      id: string;
      folio: string;
      cliente: string;
      vendedor_id: string;
      vendedor: string;
      cliente_id: string;
      contado_credito: 'contado' | 'credito';
      total: string;
      pendiente: string;
      hora: string;
      entregada: boolean | null;
    }>`
      select vn.id, vn.folio, vn.papel_entregado as entregada, cl.nombre as cliente, cl.id as cliente_id,
             v.id as vendedor_id,
             v.nombre as vendedor, vn.contado_credito,
             vn.monto_total::text as total,
             greatest(vn.monto_total - coalesce((
               select sum(a.monto) from cobranza_abono a
                where a.venta_nota_id = vn.id and a.deleted_at is null
             ), 0), 0)::text as pendiente,
             ${iso('coalesce(op.ocurrido_en, vn.created_at)')} as hora
        from venta_nota vn
        join vendedor v on v.id = vn.vendedor_id
        join sucursal s on s.id = v.sucursal_id
        join cliente cl on cl.id = vn.cliente_id
        left join lateral (
          select so.ocurrido_en from sync_operacion so
           where so.entidad_tabla = 'venta_nota' and so.entidad_id = vn.id
             and so.vendedor_id = vn.vendedor_id
           order by so.ocurrido_en limit 1
        ) op on true
       where vn.deleted_at is null and vn.fecha = ${fecha}::date and ${cond}
    `.execute(this.db);
    return r.rows.map<VentaFila>((x) => ({
      ventaId: x.id,
      folio: x.folio,
      cliente: x.cliente,
      vendedorId: x.vendedor_id,
      vendedor: x.vendedor,
      clienteId: x.cliente_id,
      contadoCredito: x.contado_credito,
      totalCentavos: aCentavos(x.total),
      pendienteCentavos: aCentavos(x.pendiente),
      hora: x.hora,
      entregada: x.entregada,
    }));
  }

  /**
   * Notas a credito vivas del vendedor de dias anteriores a `fecha`, marcadas
   * como NO entregadas (`papel_entregado = false`) y con algo pendiente
   * (monto - abonos vivos).
   */
  async notasNoEntregadas(
    vendedorId: string,
    fecha: string,
  ): Promise<NotaNoEntregada[]> {
    const r = await sql<{
      folio: string;
      cliente: string;
      fecha: string;
      total: string;
      pendiente: string;
    }>`
      select n.folio, n.cliente, n.fecha, n.total, n.pendiente::text as pendiente
        from (
          select vn.folio, cl.nombre as cliente,
                 to_char(vn.fecha, 'YYYY-MM-DD') as fecha,
                 vn.monto_total::text as total,
                 vn.monto_total - coalesce((
                   select sum(a.monto) from cobranza_abono a
                    where a.venta_nota_id = vn.id and a.deleted_at is null
                 ), 0) as pendiente
            from venta_nota vn
            join cliente cl on cl.id = vn.cliente_id
           where vn.deleted_at is null and vn.vendedor_id = ${vendedorId}::uuid
             and vn.contado_credito = 'credito'
             and vn.fecha < ${fecha}::date
             and vn.papel_entregado = false
        ) n
       where n.pendiente > 0
       order by n.fecha, n.folio
    `.execute(this.db);
    return r.rows.map((x) => ({
      folio: x.folio,
      cliente: x.cliente,
      fecha: x.fecha,
      totalCentavos: aCentavos(x.total),
      pendienteCentavos: aCentavos(x.pendiente),
    }));
  }

  /**
   * Marca la nota de papel de varias ventas del vendedor, en una transaccion:
   * si algun folio no es una venta viva a credito de ese vendedor con fecha
   * <= `hasta`, no se guarda nada y se devuelve ese folio. No mueve
   * `updated_at` (lo cuida el trigger de `venta_nota`).
   */
  async marcarPapel(
    vendedorId: string,
    hasta: string,
    usuarioId: string,
    notas: { folio: string; entregada: boolean }[],
  ): Promise<{ invalido: string | null }> {
    return this.db.transaction().execute(async (trx) => {
      const folios = notas.map((n) => n.folio);
      const r = await sql<{ id: string; folio: string }>`
        select vn.id, vn.folio from venta_nota vn
         where vn.folio = any(${folios}::text[])
           and vn.deleted_at is null and vn.vendedor_id = ${vendedorId}::uuid
           and vn.contado_credito = 'credito' and vn.fecha <= ${hasta}::date
         for update
      `.execute(trx);
      const porFolio = new Map(r.rows.map((x) => [x.folio, x.id]));
      const invalido = folios.find((f) => !porFolio.has(f));
      if (invalido !== undefined) return { invalido };
      for (const n of notas)
        await sql`
          update venta_nota
             set papel_entregado = ${n.entregada},
                 papel_revisado_en = now(),
                 papel_revisado_por_usuario_id = ${usuarioId}::uuid
           where id = ${porFolio.get(n.folio)}::uuid
        `.execute(trx);
      return { invalido: null };
    });
  }

  private async lineas(cond: RawBuilder<unknown>, fecha: string) {
    const r = await sql<{
      venta_id: string;
      volumen: string;
      producto: string;
      cantidad: number;
      precio: string;
    }>`
      select vn.id as venta_id, p.volumen,
             pr.nombre || ' ' || p.volumen as producto,
             dd.cantidad, dd.precio::text as precio
        from venta_nota vn
        join vendedor v on v.id = vn.vendedor_id
        join sucursal s on s.id = v.sucursal_id
        join venta_nota_detalle dd on dd.venta_nota_id = vn.id
        join presentacion p on p.id = dd.presentacion_id
        join producto pr on pr.id = p.producto_id
       where vn.deleted_at is null and dd.deleted_at is null
         and vn.fecha = ${fecha}::date and ${cond}
       order by dd.created_at, dd.id
    `.execute(this.db);
    return r.rows.map<LineaFila>((x) => ({
      ventaId: x.venta_id,
      presentacion: x.volumen,
      producto: x.producto,
      cantidad: Number(x.cantidad),
      precioCentavos: aCentavos(x.precio),
    }));
  }

  private async pagosContado(cond: RawBuilder<unknown>, fecha: string) {
    const r = await sql<PagoSql>`
      select vn.folio, cl.nombre as cliente, a.monto::text as monto,
             a.metodo_pago, a.saldo_pendiente::text as saldo, v.nombre as cobrador
        from cobranza_abono a
        join venta_nota vn on vn.id = a.venta_nota_id
        join vendedor v on v.id = vn.vendedor_id
        join sucursal s on s.id = v.sucursal_id
        join cliente cl on cl.id = vn.cliente_id
       where a.deleted_at is null and vn.deleted_at is null
         and a.origen = 'venta_contado'
         and a.fecha_pago = ${fecha}::date and ${cond}
       order by a.created_at, a.id
    `.execute(this.db);
    return r.rows.map((x) => aPagoFila('contado', x));
  }

  private async pagosAnteriores(
    cond: RawBuilder<unknown>,
    oficina: string | null,
    fecha: string,
  ) {
    const deVendedores = await sql<PagoSql>`
      select vn.folio, cl.nombre as cliente, a.monto::text as monto,
             a.metodo_pago, a.saldo_pendiente::text as saldo, v.nombre as cobrador
        from cobranza_abono a
        join cobro c on c.id = a.cobro_id
        join venta_nota vn on vn.id = a.venta_nota_id
        join vendedor v on v.id = c.vendedor_id
        join sucursal s on s.id = v.sucursal_id
        join cliente cl on cl.id = vn.cliente_id
       where a.deleted_at is null and c.deleted_at is null
         and vn.deleted_at is null
         and a.origen = 'cobro' and c.origen = 'cobro'
         and a.fecha_pago = ${fecha}::date and ${cond}
       order by a.created_at, a.id
    `.execute(this.db);
    const filas = deVendedores.rows.map((x) => aPagoFila('anterior', x));
    if (oficina === null) return filas;

    const deOficina = await sql<PagoSql>`
      select vn.folio, cl.nombre as cliente, a.monto::text as monto,
             a.metodo_pago, a.saldo_pendiente::text as saldo,
             null::text as cobrador
        from cobranza_abono a
        join cobro c on c.id = a.cobro_id
        join venta_nota vn on vn.id = a.venta_nota_id
        join cliente cl on cl.id = c.cliente_id
        join sucursal s on s.id = cl.sucursal_id
       where a.deleted_at is null and c.deleted_at is null
         and vn.deleted_at is null
         and a.origen = 'cobro' and c.origen = 'cobro'
         and c.vendedor_id is null
         and c.fecha_pago = ${fecha}::date and s.codigo = ${oficina}
       order by a.created_at, a.id
    `.execute(this.db);
    return [...filas, ...deOficina.rows.map((x) => aPagoFila('anterior', x))];
  }

  private async aFavor(
    cond: RawBuilder<unknown>,
    oficina: string | null,
    fecha: string,
  ) {
    const sobrante = sql`greatest(c.monto - coalesce((
        select sum(a.monto) from cobranza_abono a
         where a.cobro_id = c.id and a.deleted_at is null
      ), 0), 0)`;
    const deVendedores = await sql<{
      cobrador: string | null;
      cliente: string;
      monto: string;
    }>`
      select v.nombre as cobrador, cl.nombre as cliente,
             ${sobrante}::text as monto
        from cobro c
        join vendedor v on v.id = c.vendedor_id
        join sucursal s on s.id = v.sucursal_id
        join cliente cl on cl.id = c.cliente_id
       where c.deleted_at is null and c.origen = 'cobro'
         and c.fecha_pago = ${fecha}::date and ${cond}
    `.execute(this.db);
    const filas = [...deVendedores.rows];
    if (oficina !== null) {
      const o = await sql<{
        cobrador: string | null;
        cliente: string;
        monto: string;
      }>`
        select null::text as cobrador, cl.nombre as cliente,
               ${sobrante}::text as monto
          from cobro c
          join cliente cl on cl.id = c.cliente_id
          join sucursal s on s.id = cl.sucursal_id
         where c.deleted_at is null and c.origen = 'cobro'
           and c.vendedor_id is null
           and c.fecha_pago = ${fecha}::date and s.codigo = ${oficina}
      `.execute(this.db);
      filas.push(...o.rows);
    }
    return filas
      .map<AFavorFila>((x) => ({
        cobrador: x.cobrador,
        cliente: x.cliente,
        montoCentavos: aCentavos(x.monto),
      }))
      .filter((x) => x.montoCentavos > 0);
  }

  private async gastos(cond: RawBuilder<unknown>, fecha: string) {
    const r = await sql<{
      vendedor: string;
      descripcion: string;
      monto: string;
    }>`
      select v.nombre as vendedor,
             g.campo_nombre || coalesce(' · ' || nullif(btrim(g.comentario), ''), '')
               as descripcion,
             g.monto::text as monto
        from gasto g
        join vendedor v on v.id = g.vendedor_id
        join sucursal s on s.id = v.sucursal_id
       where g.deleted_at is null and g.fecha = ${fecha}::date and ${cond}
       order by g.registrado_en, g.id
    `.execute(this.db);
    return r.rows.map<GastoFila>((x) => ({
      vendedor: x.vendedor,
      descripcion: x.descripcion,
      montoCentavos: aCentavos(x.monto),
    }));
  }

  private async visitas(cond: RawBuilder<unknown>, fecha: string) {
    const r = await sql<{
      vendedor: string;
      cliente: string;
      hora: string;
      motivo: string;
      atendio: string | null;
      comentario: string | null;
    }>`
      select v.nombre as vendedor, cl.nombre as cliente,
             ${iso('vi.visitada_en')} as hora, m.nombre as motivo,
             vi.atendio, vi.observaciones as comentario
        from visita vi
        join vendedor v on v.id = vi.vendedor_id
        join sucursal s on s.id = v.sucursal_id
        join cliente cl on cl.id = vi.cliente_id
        join motivo_visita m on m.id = vi.motivo_visita_id
       where vi.fecha = ${fecha}::date and ${cond}
    `.execute(this.db);
    return r.rows.map<VisitaSinVentaFila>((x) => ({ ...x }));
  }

  private async promociones(cond: RawBuilder<unknown>, fecha: string) {
    const r = await sql<{
      cliente: string;
      producto: string;
      cantidad: number;
    }>`
      select cl.nombre as cliente, pr.nombre || ' ' || p.volumen as producto,
             vp.cantidad
        from venta_nota_promocion vp
        join venta_nota vn on vn.id = vp.venta_nota_id
        join vendedor v on v.id = vn.vendedor_id
        join sucursal s on s.id = v.sucursal_id
        join cliente cl on cl.id = vn.cliente_id
        join presentacion p on p.id = vp.presentacion_id
        join producto pr on pr.id = p.producto_id
       where vn.deleted_at is null and vn.fecha = ${fecha}::date and ${cond}
    `.execute(this.db);
    return r.rows.map<PromoFila>((x) => ({
      cliente: x.cliente,
      producto: x.producto,
      cantidad: Number(x.cantidad),
    }));
  }
}

interface PagoSql {
  folio: string;
  cliente: string;
  monto: string;
  metodo_pago: string;
  saldo: string;
  cobrador: string | null;
}

function aPagoFila(tipo: PagoFila['tipo'], x: PagoSql): PagoFila {
  return {
    tipo,
    folio: x.folio,
    cliente: x.cliente,
    montoCentavos: aCentavos(x.monto),
    metodo: x.metodo_pago as MetodoPago,
    saldoPendienteCentavos: aCentavos(x.saldo),
    cobrador: x.cobrador,
  };
}
