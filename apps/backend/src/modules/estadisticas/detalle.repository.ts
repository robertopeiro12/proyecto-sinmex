import { Inject, Injectable } from '@nestjs/common';
import { sql, type RawBuilder } from 'kysely';
import { DB_CONNECTION, type Database } from '../../database/database.tokens';
import type { CondicionVenta } from '../rutas/reglas-notas-ruta';
import { aCentavos } from '../sincronizacion/dinero';
import type {
  AFavorFila,
  AsignadaFila,
  GastoFila,
  LineaFila,
  MetodoPago,
  NotaNoCobradaFila,
  NotaNoEntregada,
  PagoFila,
  PromoFila,
  RutaFila,
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
  /** Solo para un vendedor: su ruta diaria de ese dia. */
  ruta: RutaFila[];
  /** Solo para un vendedor: sus notas asignadas de ese dia. */
  asignadas: AsignadaFila[];
  /** Solo para un vendedor: sus "no cobre" de ese dia. */
  notasNoCobradas: NotaNoCobradaFila[];
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
      ruta,
      asignadas,
      notasNoCobradas,
    ] = await Promise.all([
      this.ventas(cond, fecha),
      this.lineas(cond, fecha),
      this.pagosContado(cond, fecha),
      this.pagosAnteriores(cond, oficina, fecha),
      this.aFavor(cond, oficina, fecha),
      this.gastos(cond, fecha),
      this.visitas(cond, fecha),
      this.promociones(cond, fecha),
      'vendedorId' in a
        ? this.ruta(a.vendedorId, fecha)
        : Promise.resolve<RutaFila[]>([]),
      'vendedorId' in a
        ? this.asignadas(a.vendedorId, fecha)
        : Promise.resolve<AsignadaFila[]>([]),
      'vendedorId' in a
        ? this.notasNoCobradas(a.vendedorId, fecha)
        : Promise.resolve<NotaNoCobradaFila[]>([]),
    ]);
    return {
      ventas,
      lineas,
      pagos: [...contado, ...anteriores],
      aFavor,
      gastos,
      visitasSinVenta: visitas,
      promociones: promos,
      ruta,
      asignadas,
      notasNoCobradas,
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
      status: VentaFila['status'];
    }>`
      select vn.id, vn.folio, vn.papel_entregado as entregada, vn.status,
             cl.nombre as cliente, cl.id as cliente_id,
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
      status: x.status,
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
   * Las notas asignadas vivas del vendedor ese dia (de ventas vivas), con el
   * saldo de HOY de la venta (monto - abonos vivos, nunca menor que 0) y la
   * marca de papel de la asignacion. Sin las que tienen saldo y no se cobran
   * (status fuera de `pendiente`/`abonado`, p. ej. cuenta perdida): no se piden.
   */
  private async asignadas(
    vendedorId: string,
    fecha: string,
  ): Promise<AsignadaFila[]> {
    const r = await sql<{
      id: string;
      folio: string;
      cliente: string;
      total: string;
      pendiente: string;
      entregada: boolean | null;
      condicion_venta: CondicionVenta;
      comentario: string | null;
      comentario_vendedor: string | null;
    }>`
      select vn.id, vn.folio, cl.nombre as cliente,
             vn.monto_total::text as total,
             greatest(vn.monto_total - ab.abonado, 0)::text as pendiente,
             na.papel_entregado as entregada,
             na.condicion_venta,
             nc.comentario, nc.vendedor as comentario_vendedor
        from nota_asignada na
        join venta_nota vn on vn.id = na.venta_nota_id
        join cliente cl on cl.id = vn.cliente_id
        cross join lateral (
          select coalesce(sum(a.monto), 0) as abonado from cobranza_abono a
           where a.venta_nota_id = vn.id and a.deleted_at is null
        ) ab
        left join lateral (
          select c.comentario, cv.nombre as vendedor
            from nota_no_cobrada c
            join vendedor cv on cv.id = c.vendedor_id
           where c.venta_nota_id = vn.id and c.fecha = ${fecha}::date
             and c.deleted_at is null
           order by c.registrado_en desc, c.id desc
           limit 1
        ) nc on true
       where na.deleted_at is null and vn.deleted_at is null
         and na.vendedor_id = ${vendedorId}::uuid and na.fecha = ${fecha}::date
         and (vn.status in ('pendiente', 'abonado')
              or vn.monto_total - ab.abonado <= 0)
    `.execute(this.db);
    return r.rows.map((x) => ({
      ventaNotaId: x.id,
      folio: x.folio,
      cliente: x.cliente,
      totalCentavos: aCentavos(x.total),
      pendienteCentavos: aCentavos(x.pendiente),
      entregada: x.entregada,
      condicionVenta: x.condicion_venta,
      comentarioVendedor:
        x.comentario !== null && x.comentario_vendedor !== null
          ? { texto: x.comentario, vendedor: x.comentario_vendedor }
          : null,
    }));
  }

  /** Los "no cobre" vivos del vendedor ese dia, con su cliente y folio. */
  private async notasNoCobradas(
    vendedorId: string,
    fecha: string,
  ): Promise<NotaNoCobradaFila[]> {
    const r = await sql<{
      cliente_id: string;
      cliente: string;
      folio: string;
      hora: string;
      comentario: string;
    }>`
      select cl.id as cliente_id, cl.nombre as cliente, vn.folio,
             ${iso('c.registrado_en')} as hora, c.comentario
        from nota_no_cobrada c
        join venta_nota vn on vn.id = c.venta_nota_id
        join cliente cl on cl.id = vn.cliente_id
       where c.deleted_at is null
         and c.vendedor_id = ${vendedorId}::uuid and c.fecha = ${fecha}::date
       order by c.registrado_en, c.id
    `.execute(this.db);
    return r.rows.map((x) => ({
      clienteId: x.cliente_id,
      cliente: x.cliente,
      folio: x.folio,
      hora: x.hora,
      comentario: x.comentario,
    }));
  }

  /**
   * Guarda la revision de papel de un vendedor en una transaccion: sus ventas a
   * credito (`notas`, por folio) y sus notas asignadas (`asignadas`, por
   * venta). Una venta vale si esta viva, es a credito, es del vendedor y su
   * fecha es `ventas.fecha` (o, con `ventas.hasta`, cualquiera hasta ese dia:
   * la forma vieja, sin fecha). Una asignada vale si esta viva, de una venta
   * viva, es del vendedor y de `fechaAsignadas`. Si alguna no vale no se guarda
   * nada y se devuelve cual. Solo escribe las que cambian de valor (conservan
   * quien y cuando las marco). En `venta_nota` no mueve `updated_at` (lo cuida
   * su trigger); en `nota_asignada` si (ver la migracion).
   */
  async marcarPapel(
    vendedorId: string,
    usuarioId: string,
    ventas: { fecha: string; hasta: boolean },
    fechaAsignadas: string,
    notas: { folio: string; entregada: boolean }[],
    asignadas: { ventaNotaId: string; entregada: boolean }[],
  ): Promise<{ invalido: { folio: string } | 'asignada' | null }> {
    return this.db.transaction().execute(async (trx) => {
      const folios = notas.map((n) => n.folio);
      const porFolio = new Map<string, string>();
      if (folios.length > 0) {
        const r = await sql<{ id: string; folio: string }>`
          select vn.id, vn.folio from venta_nota vn
           where vn.folio = any(${folios}::text[])
             and vn.deleted_at is null and vn.vendedor_id = ${vendedorId}::uuid
             and vn.contado_credito = 'credito'
             and ${ventas.hasta ? sql`vn.fecha <= ${ventas.fecha}::date` : sql`vn.fecha = ${ventas.fecha}::date`}
           for update
        `.execute(trx);
        for (const x of r.rows) porFolio.set(x.folio, x.id);
        const malo = folios.find((f) => !porFolio.has(f));
        if (malo !== undefined) return { invalido: { folio: malo } };
      }

      const ventaIds = asignadas.map((a) => a.ventaNotaId);
      const porVenta = new Map<string, string>();
      if (ventaIds.length > 0) {
        const r = await sql<{ id: string; venta_nota_id: string }>`
          select na.id, na.venta_nota_id from nota_asignada na
            join venta_nota vn on vn.id = na.venta_nota_id
           where na.venta_nota_id = any(${ventaIds}::uuid[])
             and na.deleted_at is null and vn.deleted_at is null
             and na.vendedor_id = ${vendedorId}::uuid
             and na.fecha = ${fechaAsignadas}::date
           for update of na
        `.execute(trx);
        for (const x of r.rows) porVenta.set(x.venta_nota_id, x.id);
        const mala = ventaIds.find((id) => !porVenta.has(id));
        if (mala !== undefined) {
          // Para el mensaje: el folio de esa venta, si existe.
          const f = await sql<{ folio: string }>`
            select folio from venta_nota where id = ${mala}::uuid
          `.execute(trx);
          return {
            invalido: f.rows[0] ? { folio: f.rows[0].folio } : 'asignada',
          };
        }
      }

      // Solo las que de verdad cambian: quien y cuando quedan del primero que
      // la marco con ese valor (guardar dos veces lo mismo no reescribe nada).
      if (notas.length > 0)
        await sql`
          update venta_nota vn
             set papel_entregado = m.entregada,
                 papel_revisado_en = now(),
                 papel_revisado_por_usuario_id = ${usuarioId}::uuid
            from unnest(
                   ${notas.map((n) => porFolio.get(n.folio))}::uuid[],
                   ${notas.map((n) => n.entregada)}::boolean[]
                 ) as m(id, entregada)
           where vn.id = m.id
             and vn.papel_entregado is distinct from m.entregada
        `.execute(trx);
      if (asignadas.length > 0)
        await sql`
          update nota_asignada na
             set papel_entregado = m.entregada,
                 papel_revisado_en = now(),
                 papel_revisado_por_usuario_id = ${usuarioId}::uuid
            from unnest(
                   ${asignadas.map((a) => porVenta.get(a.ventaNotaId))}::uuid[],
                   ${asignadas.map((a) => a.entregada)}::boolean[]
                 ) as m(id, entregada)
           where na.id = m.id
             and na.papel_entregado is distinct from m.entregada
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
      cliente_id: string;
      cliente: string;
      hora: string;
      motivo: string;
      atendio: string | null;
      comentario: string | null;
    }>`
      select v.nombre as vendedor, cl.id as cliente_id, cl.nombre as cliente,
             ${iso('vi.visitada_en')} as hora, m.nombre as motivo,
             vi.atendio, vi.observaciones as comentario
        from visita vi
        join vendedor v on v.id = vi.vendedor_id
        join sucursal s on s.id = v.sucursal_id
        join cliente cl on cl.id = vi.cliente_id
        join motivo_visita m on m.id = vi.motivo_visita_id
       where vi.fecha = ${fecha}::date and ${cond}
    `.execute(this.db);
    return r.rows.map<VisitaSinVentaFila>((x) => ({
      vendedor: x.vendedor,
      clienteId: x.cliente_id,
      cliente: x.cliente,
      hora: x.hora,
      motivo: x.motivo,
      atendio: x.atendio,
      comentario: x.comentario,
    }));
  }

  /** La ruta diaria viva del vendedor ese dia, en su orden (T-37). */
  private async ruta(vendedorId: string, fecha: string): Promise<RutaFila[]> {
    const r = await sql<{ cliente_id: string; cliente: string; orden: number }>`
      select r.cliente_id, cl.nombre as cliente, r.orden
        from ruta r
        join cliente cl on cl.id = r.cliente_id
       where r.deleted_at is null and r.tipo = 'diaria'
         and r.vendedor_id = ${vendedorId}::uuid and r.fecha = ${fecha}::date
       order by r.orden, cl.nombre
    `.execute(this.db);
    return r.rows.map((x) => ({
      clienteId: x.cliente_id,
      cliente: x.cliente,
      orden: Number(x.orden),
    }));
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
