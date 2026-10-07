import { Inject, Injectable } from '@nestjs/common';
import { sql, type RawBuilder, type Transaction } from 'kysely';
import { DB_CONNECTION, type Database } from '../../database/database.tokens';
import type { DB } from '../../database/schema';
import { aCentavos } from '../sincronizacion/dinero';
import type { VentaParaFacturar } from './facturas';

export interface VentaDeFactura {
  id: string;
  folio: string;
  fecha: string;
  numNota: string | null;
  montoCentavos: number;
  status: string;
}

export interface VentaPorFacturar extends VentaDeFactura {
  factura: 'N/A' | 'pendiente';
}

export interface FacturaConVentas {
  id: string;
  numero: string;
  clienteId: string;
  cliente: string;
  sucursalCodigo: string;
  creadoPor: string;
  creadoEn: string;
  totalCentavos: number;
  ventas: VentaDeFactura[];
}

/** La factura bloqueada `for update`, con la sucursal de su cliente para el alcance. */
export interface FacturaBloqueada {
  id: string;
  numero: string;
  clienteId: string;
  sucursalCodigo: string;
}

export interface FiltroFacturas {
  numero: string | null;
  clienteId: string | null;
  /** `null` = todas las sucursales (usuario General sin filtro). */
  sucursalCodigo: string | null;
}

export const TOPE_BUSQUEDA_FACTURAS = 100;

/**
 * SQL de facturas (T-19). Como `VentasEdicionRepository`: los metodos de
 * escritura reciben la `trx` y ninguno abre la suya; la abre `FacturasService`.
 * Las fechas salen con `to_char` (un `date` leido como `Date` se corre un dia).
 */
@Injectable()
export class FacturasRepository {
  constructor(@Inject(DB_CONNECTION) private readonly db: Database) {}

  /** Ventas vivas del cliente sin factura; `N/A` solo si se pide. Sin promociones. */
  async porFacturar(
    clienteId: string,
    incluirNA: boolean,
  ): Promise<VentaPorFacturar[]> {
    const estados = incluirNA ? ['pendiente', 'N/A'] : ['pendiente'];
    const filas = await sql<{
      id: string;
      folio: string;
      fecha: string;
      num_nota: string | null;
      monto_total: string;
      status: string;
      factura: 'N/A' | 'pendiente';
    }>`
      select vn.id, vn.folio, to_char(vn.fecha, 'YYYY-MM-DD') as fecha, vn.num_nota,
             vn.monto_total, vn.status, vn.factura
        from venta_nota vn
       where vn.cliente_id = ${clienteId}
         and vn.deleted_at is null
         and vn.status <> 'promocion'
         and vn.factura = any(${estados}::text[])
       order by vn.fecha, vn.folio
    `.execute(this.db);
    return filas.rows.map((f) => ({
      id: f.id,
      folio: f.folio,
      fecha: f.fecha,
      numNota: f.num_nota,
      montoCentavos: aCentavos(f.monto_total),
      status: f.status,
      factura: f.factura,
    }));
  }

  /** Bloquea las ventas VIVAS de esa lista. Las eliminadas o inexistentes no vuelven. */
  async bloquearVentas(
    ids: string[],
    trx: Transaction<DB>,
  ): Promise<VentaParaFacturar[]> {
    const filas = await sql<{
      id: string;
      folio: string;
      cliente_id: string;
      status: string;
      factura_id: string | null;
      factura_numero: string | null;
    }>`
      select vn.id, vn.folio, vn.cliente_id, vn.status, vn.factura_id,
             f.numero as factura_numero
        from venta_nota vn
        left join factura f on f.id = vn.factura_id
       where vn.id = any(${ids}::uuid[])
         and vn.deleted_at is null
       order by vn.id
         for update of vn
    `.execute(trx);
    return filas.rows.map((f) => ({
      id: f.id,
      folio: f.folio,
      clienteId: f.cliente_id,
      status: f.status,
      facturaId: f.factura_id,
      facturaNumero: f.factura_numero,
    }));
  }

  /** Por numero como lo compara `uq_factura_numero`. */
  async facturaPorNumero(
    numero: string,
    conexion: Database | Transaction<DB> = this.db,
  ): Promise<
    | { id: string; numero: string; clienteId: string; cliente: string }
    | undefined
  > {
    const filas = await sql<{
      id: string;
      numero: string;
      cliente_id: string;
      cliente: string;
    }>`
      select f.id, f.numero, f.cliente_id, c.nombre as cliente
        from factura f
        join cliente c on c.id = f.cliente_id
       where lower(btrim(f.numero)) = lower(btrim(${numero}))
    `.execute(conexion);
    const f = filas.rows[0];
    return f
      ? {
          id: f.id,
          numero: f.numero,
          clienteId: f.cliente_id,
          cliente: f.cliente,
        }
      : undefined;
  }

  async bloquearFactura(
    id: string,
    trx: Transaction<DB>,
  ): Promise<FacturaBloqueada | undefined> {
    const filas = await sql<{
      id: string;
      numero: string;
      cliente_id: string;
      codigo: string;
    }>`
      select f.id, f.numero, f.cliente_id, s.codigo
        from factura f
        join cliente c on c.id = f.cliente_id
        join sucursal s on s.id = c.sucursal_id
       where f.id = ${id}
         for update of f
    `.execute(trx);
    const f = filas.rows[0];
    return f
      ? {
          id: f.id,
          numero: f.numero,
          clienteId: f.cliente_id,
          sucursalCodigo: f.codigo,
        }
      : undefined;
  }

  async crearFactura(
    numero: string,
    clienteId: string,
    usuarioId: string,
    trx: Transaction<DB>,
  ): Promise<string> {
    const { id } = await trx
      .insertInto('factura')
      .values({
        numero,
        cliente_id: clienteId,
        creado_por_usuario_id: usuarioId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return id;
  }

  async asignarVentas(
    facturaId: string,
    ventaIds: string[],
    usuarioId: string,
    trx: Transaction<DB>,
  ): Promise<void> {
    await sql`
      update venta_nota
         set factura = 'facturada',
             factura_id = ${facturaId},
             factura_asignada_por_usuario_id = ${usuarioId},
             factura_asignada_en = now()
       where id = any(${ventaIds}::uuid[])
    `.execute(trx);
  }

  async renombrar(
    id: string,
    numero: string,
    usuarioId: string,
    trx: Transaction<DB>,
  ): Promise<void> {
    await sql`
      update factura
         set numero = ${numero},
             actualizado_por_usuario_id = ${usuarioId},
             actualizado_en = now()
       where id = ${id}
    `.execute(trx);
  }

  /** Regresan a `pendiente`: alguien las marco para facturar y siguen sin factura. */
  async quitarVentas(
    facturaId: string,
    ventaIds: string[],
    trx: Transaction<DB>,
  ): Promise<void> {
    await sql`
      update venta_nota
         set factura = 'pendiente',
             factura_id = null,
             factura_asignada_por_usuario_id = null,
             factura_asignada_en = null
       where factura_id = ${facturaId}
         and id = any(${ventaIds}::uuid[])
    `.execute(trx);
  }

  /** Borra la factura si ya no le queda ninguna venta. Devuelve si la borro. */
  async borrarSiVacia(
    facturaId: string,
    trx: Transaction<DB>,
  ): Promise<boolean> {
    const res = await sql`
      delete from factura
       where id = ${facturaId}
         and not exists (select 1 from venta_nota vn where vn.factura_id = ${facturaId})
    `.execute(trx);
    return Number(res.numAffectedRows ?? 0) > 0;
  }

  async buscar(filtro: FiltroFacturas): Promise<FacturaConVentas[]> {
    const condiciones = [sql`true`];
    if (filtro.numero !== null)
      condiciones.push(
        sql`lower(btrim(f.numero)) = lower(btrim(${filtro.numero}))`,
      );
    if (filtro.clienteId !== null)
      condiciones.push(sql`f.cliente_id = ${filtro.clienteId}`);
    if (filtro.sucursalCodigo !== null)
      condiciones.push(sql`s.codigo = ${filtro.sucursalCodigo}`);
    return this.leer(sql.join(condiciones, sql` and `));
  }

  async leerFactura(id: string): Promise<FacturaConVentas | undefined> {
    return (await this.leer(sql`f.id = ${id}`))[0];
  }

  private async leer(donde: RawBuilder<unknown>): Promise<FacturaConVentas[]> {
    const facturas = await sql<{
      id: string;
      numero: string;
      cliente_id: string;
      cliente: string;
      codigo: string;
      creado_por: string;
      creado_en: string;
    }>`
      select f.id, f.numero, f.cliente_id, c.nombre as cliente, s.codigo,
             u.nombre as creado_por,
             to_char(f.creado_en at time zone 'America/Tijuana', 'YYYY-MM-DD HH24:MI') as creado_en
        from factura f
        join cliente c on c.id = f.cliente_id
        join sucursal s on s.id = c.sucursal_id
        join usuario u on u.id = f.creado_por_usuario_id
       where ${donde}
       order by f.creado_en desc
       limit ${TOPE_BUSQUEDA_FACTURAS}
    `.execute(this.db);
    if (facturas.rows.length === 0) return [];

    const ids = facturas.rows.map((f) => f.id);
    const ventas = await sql<{
      factura_id: string;
      id: string;
      folio: string;
      fecha: string;
      num_nota: string | null;
      monto_total: string;
      status: string;
    }>`
      select vn.factura_id, vn.id, vn.folio, to_char(vn.fecha, 'YYYY-MM-DD') as fecha,
             vn.num_nota, vn.monto_total, vn.status
        from venta_nota vn
       where vn.factura_id = any(${ids}::uuid[])
       order by vn.fecha, vn.folio
    `.execute(this.db);

    return facturas.rows.map((f) => {
      const suyas = ventas.rows
        .filter((v) => v.factura_id === f.id)
        .map((v) => ({
          id: v.id,
          folio: v.folio,
          fecha: v.fecha,
          numNota: v.num_nota,
          montoCentavos: aCentavos(v.monto_total),
          status: v.status,
        }));
      return {
        id: f.id,
        numero: f.numero,
        clienteId: f.cliente_id,
        cliente: f.cliente,
        sucursalCodigo: f.codigo,
        creadoPor: f.creado_por,
        creadoEn: f.creado_en,
        totalCentavos: suyas.reduce((t, v) => t + v.montoCentavos, 0),
        ventas: suyas,
      };
    });
  }
}
