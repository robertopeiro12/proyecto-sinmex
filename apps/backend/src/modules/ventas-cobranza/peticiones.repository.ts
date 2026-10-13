import { Inject, Injectable } from '@nestjs/common';
import { sql, type Transaction } from 'kysely';
import { DB_CONNECTION, type Database } from '../../database/database.tokens';
import type { DB } from '../../database/schema';
import { aCentavos } from '../sincronizacion/dinero';

export type StatusPeticion = 'pendiente' | 'autorizada' | 'denegada';

/** El pago de una peticion, para pintarlo en la bandeja. */
export interface CobroDePeticion {
  id: string;
  clienteId: string;
  cliente: string;
  montoCentavos: number;
  metodoPago: string;
  origen: 'cobro' | 'saldo_favor';
  /** `AAAA-MM-DD`. */
  fechaPago: string;
  /** Nombre del vendedor; `null` = Oficina (o saldo a favor). */
  cobrador: string | null;
  /** Folios de las notas del pago, por fecha y folio. Incluye filas ya borradas (historial). */
  folios: string[];
}

/** Un renglon de la bandeja (§3.2). Fechas en hora de Tijuana, `AAAA-MM-DD HH:MM`. */
export interface PeticionEnBandeja {
  id: string;
  tipo: 'eliminar_cobro';
  status: StatusPeticion;
  sucursalCodigo: string;
  motivo: string;
  /** Nombre de quien la pidio. */
  solicito: string;
  creadaEn: string;
  resolvio: string | null;
  resueltaEn: string | null;
  comentario: string | null;
  cobro: CobroDePeticion;
}

/** Ya resuelto por el servicio: el alcance aplicado. */
export interface FiltroBandeja {
  id?: string;
  status?: 'pendiente' | 'historial';
  /** `null` = todas las sucursales. */
  sucursalCodigo: string | null;
}

/** Lo minimo para decidir sobre una peticion. */
export interface PeticionParaResolver {
  id: string;
  status: StatusPeticion;
  cobroId: string;
  sucursalCodigo: string;
}

/** El historial muestra solo las mas recientes (§5: sin paginacion por ahora). */
export const LIMITE_HISTORIAL = 200;

/**
 * SQL de la bandeja de peticiones (T-34). Las escrituras reciben la `trx` de
 * `PeticionesService`, que abre UNA transaccion por accion (con
 * `VentasPortalRepository.enTransaccion`, como la cobranza del portal).
 */
@Injectable()
export class PeticionesRepository {
  constructor(@Inject(DB_CONNECTION) private readonly db: Database) {}

  async buscar(filtro: FiltroBandeja): Promise<PeticionEnBandeja[]> {
    const condiciones = [sql`true`];
    if (filtro.id !== undefined) condiciones.push(sql`p.id = ${filtro.id}`);
    if (filtro.status === 'pendiente')
      condiciones.push(sql`p.status = 'pendiente'`);
    if (filtro.status === 'historial')
      condiciones.push(sql`p.status <> 'pendiente'`);
    if (filtro.sucursalCodigo !== null)
      condiciones.push(sql`s.codigo = ${filtro.sucursalCodigo}`);
    const orden =
      filtro.status === 'historial'
        ? sql`order by p.resuelta_en desc, p.created_at desc limit ${LIMITE_HISTORIAL}`
        : sql`order by p.created_at, p.id`;

    const filas = await sql<{
      id: string;
      status: string;
      sucursal_codigo: string;
      motivo: string;
      solicito: string;
      creada_en: string;
      resolvio: string | null;
      resuelta_en: string | null;
      comentario: string | null;
      cobro_id: string;
      cliente_id: string;
      cliente: string;
      monto: string;
      metodo_pago: string;
      origen: string;
      fecha_pago: string;
      cobrador: string | null;
      folios: string[];
    }>`
      select p.id, p.status, s.codigo as sucursal_codigo, p.motivo,
             us.nombre as solicito,
             to_char(p.created_at at time zone 'America/Tijuana', 'YYYY-MM-DD HH24:MI') as creada_en,
             ur.nombre as resolvio,
             to_char(p.resuelta_en at time zone 'America/Tijuana', 'YYYY-MM-DD HH24:MI') as resuelta_en,
             p.comentario_resolucion as comentario,
             co.id as cobro_id, co.cliente_id, c.nombre as cliente,
             co.monto::text as monto, co.metodo_pago, co.origen,
             to_char(co.fecha_pago, 'YYYY-MM-DD') as fecha_pago,
             v.nombre as cobrador,
             coalesce((select array_agg(vn.folio order by vn.fecha, vn.folio)
                         from venta_nota vn
                        where vn.id in (select ca.venta_nota_id
                                          from cobranza_abono ca
                                         where ca.cobro_id = co.id)),
                      '{}') as folios
        from peticion p
        join sucursal s on s.id = p.sucursal_id
        join usuario us on us.id = p.solicito_usuario_id
        left join usuario ur on ur.id = p.resuelta_por_usuario_id
        join cobro co on co.id = p.cobro_id
        join cliente c on c.id = co.cliente_id
        left join vendedor v on v.id = co.vendedor_id
       where ${sql.join(condiciones, sql` and `)}
       ${orden}
    `.execute(this.db);

    return filas.rows.map((f) => ({
      id: f.id,
      tipo: 'eliminar_cobro',
      status: f.status as StatusPeticion,
      sucursalCodigo: f.sucursal_codigo,
      motivo: f.motivo,
      solicito: f.solicito,
      creadaEn: f.creada_en,
      resolvio: f.resolvio,
      resueltaEn: f.resuelta_en,
      comentario: f.comentario,
      cobro: {
        id: f.cobro_id,
        clienteId: f.cliente_id,
        cliente: f.cliente,
        montoCentavos: aCentavos(f.monto),
        metodoPago: f.metodo_pago,
        origen: f.origen as 'cobro' | 'saldo_favor',
        fechaPago: f.fecha_pago,
        cobrador: f.cobrador,
        folios: f.folios,
      },
    }));
  }

  /** Pendiente por default. El `unique` parcial decide si ya hay otra (23505). */
  async insertar(
    nueva: {
      cobroId: string;
      sucursalId: string;
      motivo: string;
      usuarioId: string;
    },
    trx: Transaction<DB>,
  ): Promise<string> {
    const fila = await trx
      .insertInto('peticion')
      .values({
        tipo: 'eliminar_cobro',
        cobro_id: nueva.cobroId,
        sucursal_id: nueva.sucursalId,
        motivo: nueva.motivo,
        solicito_usuario_id: nueva.usuarioId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return fila.id;
  }

  /** Sin candado: para la vista previa de una peticion. */
  cabecera(
    id: string,
    conexion: Database = this.db,
  ): Promise<PeticionParaResolver | undefined> {
    return this.leer(id, false, conexion);
  }

  /**
   * `for update of p`: el PRIMER candado de autorizar y denegar. Ningun cobro
   * bloquea peticiones, asi que tomarlo antes que las notas no arma ciclos.
   * Dos resoluciones a la vez: la segunda espera aqui y luego ve la resuelta.
   */
  bloquear(
    id: string,
    trx: Transaction<DB>,
  ): Promise<PeticionParaResolver | undefined> {
    return this.leer(id, true, trx);
  }

  async resolver(
    id: string,
    resolucion: {
      status: 'autorizada' | 'denegada';
      usuarioId: string;
      comentario: string | null;
    },
    trx: Transaction<DB>,
  ): Promise<void> {
    await trx
      .updateTable('peticion')
      .set({
        status: resolucion.status,
        resuelta_por_usuario_id: resolucion.usuarioId,
        resuelta_en: sql`now()`,
        comentario_resolucion: resolucion.comentario,
      })
      .where('id', '=', id)
      .execute();
  }

  private async leer(
    id: string,
    bloquear: boolean,
    conexion: Database,
  ): Promise<PeticionParaResolver | undefined> {
    const filas = await sql<{
      id: string;
      status: string;
      cobro_id: string;
      sucursal_codigo: string;
    }>`
      select p.id, p.status, p.cobro_id, s.codigo as sucursal_codigo
        from peticion p
        join sucursal s on s.id = p.sucursal_id
       where p.id = ${id}
       ${bloquear ? sql`for update of p` : sql``}
    `.execute(conexion);
    const f = filas.rows[0];
    return f
      ? {
          id: f.id,
          status: f.status as StatusPeticion,
          cobroId: f.cobro_id,
          sucursalCodigo: f.sucursal_codigo,
        }
      : undefined;
  }
}
