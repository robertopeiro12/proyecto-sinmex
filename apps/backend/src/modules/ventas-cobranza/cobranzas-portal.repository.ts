import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DB_CONNECTION, type Database } from '../../database/database.tokens';
import { aCentavos } from '../sincronizacion/dinero';
import { saldoDerivadoCentavos } from './reglas-cobranza';

export type OrigenAbono = 'cobro' | 'venta_contado' | 'saldo_favor';

/** Un abono vivo de una nota, para "abonos anteriores" (§3.2). */
export interface AbonoAnterior {
  fechaPago: string;
  montoCentavos: number;
  metodoPago: string;
  origen: OrigenAbono;
}

/** Una nota por cobrar: `pendiente`/`abonado` y viva (§3.1, §3.2). */
export interface NotaPorCobrar {
  id: string;
  folio: string;
  /** `null` si no hubo nota de papel. */
  numNota: string | null;
  /** `AAAA-MM-DD`. */
  fecha: string;
  clienteId: string;
  cliente: string;
  /** La sucursal del CLIENTE: la que define el alcance, como en el cobro. */
  sucursalCodigo: string;
  montoCentavos: number;
  /** Derivado (D7): monto menos abonos vivos, nunca negativo. */
  saldoCentavos: number;
  status: 'pendiente' | 'abonado';
  /** Por fecha de pago. */
  abonos: AbonoAnterior[];
}

export interface ClienteParaCobro {
  id: string;
  nombre: string;
  sucursalId: string;
  sucursalCodigo: string;
}

/** Ya resuelto por el servicio: un solo filtro y el alcance aplicado. */
export interface FiltroPorCobrar {
  clienteId: string | null;
  fecha: string | null;
  numNota: string | null;
  /** `null` = todas las sucursales. */
  sucursalCodigo: string | null;
}

/**
 * Lecturas de la pantalla de cobranza del portal (T-21). Las escrituras van
 * por `CobranzasService`, el mismo de la tablet. Fechas con `to_char`: un
 * `date` leido como `Date` se corre un dia segun el huso del proceso.
 */
@Injectable()
export class CobranzasPortalRepository {
  constructor(@Inject(DB_CONNECTION) private readonly db: Database) {}

  /** El cliente, vivo, con su sucursal. Acepta la `trx` del cobro. */
  async clienteParaCobro(
    clienteId: string,
    conexion: Database = this.db,
  ): Promise<ClienteParaCobro | undefined> {
    const fila = await conexion
      .selectFrom('cliente')
      .innerJoin('sucursal', 'sucursal.id', 'cliente.sucursal_id')
      .select([
        'cliente.id as id',
        'cliente.nombre as nombre',
        'cliente.sucursal_id as sucursal_id',
        'sucursal.codigo as codigo',
      ])
      .where('cliente.id', '=', clienteId)
      .where('cliente.deleted_at', 'is', null)
      .executeTakeFirst();
    return fila
      ? {
          id: fila.id,
          nombre: fila.nombre,
          sucursalId: fila.sucursal_id,
          sucursalCodigo: fila.codigo,
        }
      : undefined;
  }

  /**
   * Notas por cobrar, de la mas vieja a la mas nueva. El # de nota se compara
   * como en la busqueda de ventas: `lower(btrim(...))`, exacto.
   */
  async notasPorCobrar(filtro: FiltroPorCobrar): Promise<NotaPorCobrar[]> {
    const condiciones = [
      sql`vn.deleted_at is null`,
      sql`vn.status in ('pendiente', 'abonado')`,
    ];
    if (filtro.clienteId !== null)
      condiciones.push(sql`vn.cliente_id = ${filtro.clienteId}::uuid`);
    if (filtro.fecha !== null)
      condiciones.push(sql`vn.fecha = ${filtro.fecha}::date`);
    if (filtro.numNota !== null)
      condiciones.push(
        sql`lower(btrim(vn.num_nota)) = lower(btrim(${filtro.numNota}))`,
      );
    if (filtro.sucursalCodigo !== null)
      condiciones.push(sql`s.codigo = ${filtro.sucursalCodigo}`);

    const filas = await sql<{
      id: string;
      folio: string;
      num_nota: string | null;
      fecha: string;
      cliente_id: string;
      cliente: string;
      sucursal_codigo: string;
      monto_total: string;
      status: string;
      abonado: string;
      abonos: {
        fecha_pago: string;
        monto: string;
        metodo_pago: string;
        origen: string;
      }[];
    }>`
      select vn.id, vn.folio, vn.num_nota,
             to_char(vn.fecha, 'YYYY-MM-DD') as fecha,
             vn.cliente_id, c.nombre as cliente, s.codigo as sucursal_codigo,
             vn.monto_total, vn.status,
             coalesce(a.abonado, 0)::text as abonado,
             coalesce(a.abonos, '[]'::json) as abonos
        from venta_nota vn
        join cliente c on c.id = vn.cliente_id
        join sucursal s on s.id = c.sucursal_id
        left join lateral (
          select sum(ca.monto) as abonado,
                 json_agg(
                   json_build_object(
                     'fecha_pago', to_char(ca.fecha_pago, 'YYYY-MM-DD'),
                     'monto', ca.monto::text,
                     'metodo_pago', ca.metodo_pago,
                     'origen', ca.origen
                   ) order by ca.fecha_pago, ca.created_at
                 ) as abonos
            from cobranza_abono ca
           where ca.venta_nota_id = vn.id
             and ca.deleted_at is null
        ) a on true
       where ${sql.join(condiciones, sql` and `)}
       order by vn.fecha, vn.folio
    `.execute(this.db);

    return filas.rows.map((f) => ({
      id: f.id,
      folio: f.folio,
      numNota: f.num_nota,
      fecha: f.fecha,
      clienteId: f.cliente_id,
      cliente: f.cliente,
      sucursalCodigo: f.sucursal_codigo,
      montoCentavos: aCentavos(f.monto_total),
      saldoCentavos: saldoDerivadoCentavos(
        aCentavos(f.monto_total),
        aCentavos(f.abonado),
      ),
      status: f.status as 'pendiente' | 'abonado',
      abonos: f.abonos.map((a) => ({
        fechaPago: a.fecha_pago,
        montoCentavos: aCentavos(a.monto),
        metodoPago: a.metodo_pago,
        origen: a.origen as OrigenAbono,
      })),
    }));
  }

  /** La suma de los movimientos vivos (D5), en centavos. Solo para pintar. */
  async saldoFavorCentavos(clienteId: string): Promise<number> {
    const fila = await this.db
      .selectFrom('saldo_favor_movimiento')
      .select(sql<string>`coalesce(sum(monto), 0)::text`.as('total'))
      .where('cliente_id', '=', clienteId)
      .where('deleted_at', 'is', null)
      .executeTakeFirstOrThrow();
    return aCentavos(fila.total);
  }
}
