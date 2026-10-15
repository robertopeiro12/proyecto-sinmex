import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DB_CONNECTION, type Database } from '../../database/database.tokens';
import { buscarSucursalUsuario } from '../sucursales/buscar-sucursal-usuario';
import { aCentavos, aPesos } from '../sincronizacion/dinero';
import {
  ordenarCuentas,
  type CuentaEnAlcance,
  type SaldoFijado,
} from './reglas-saldo';

@Injectable()
export class TesoreriaRepository {
  constructor(@Inject(DB_CONNECTION) private readonly db: Database) {}

  private consultaCuentas() {
    return this.db
      .selectFrom('tesoreria_cuenta')
      .leftJoin('sucursal', 'sucursal.id', 'tesoreria_cuenta.sucursal_id')
      .select([
        'tesoreria_cuenta.id as id',
        'tesoreria_cuenta.nombre as nombre',
        'tesoreria_cuenta.sucursal_id as sucursalId',
        'sucursal.codigo as sucursalCodigo',
      ])
      .where('tesoreria_cuenta.deleted_at', 'is', null);
  }

  /**
   * Vivas en alcance. `codigoSucursal` null = todas; con codigo = las de esa
   * sucursal MAS las generales (spec §3.2).
   */
  async listarCuentas(
    codigoSucursal: string | null,
  ): Promise<CuentaEnAlcance[]> {
    let q = this.consultaCuentas();
    if (codigoSucursal !== null) {
      q = q.where((eb) =>
        eb.or([
          eb('sucursal.codigo', '=', codigoSucursal),
          eb('tesoreria_cuenta.sucursal_id', 'is', null),
        ]),
      );
    }
    return ordenarCuentas(await q.execute());
  }

  async buscarCuenta(id: string): Promise<CuentaEnAlcance | undefined> {
    return this.consultaCuentas()
      .where('tesoreria_cuenta.id', '=', id)
      .executeTakeFirst();
  }

  async crearCuenta(
    nombre: string,
    sucursalId: string | null,
  ): Promise<CuentaEnAlcance | undefined> {
    const { id } = await this.db
      .insertInto('tesoreria_cuenta')
      .values({ nombre, sucursal_id: sucursalId })
      .returning('id')
      .executeTakeFirstOrThrow();
    // Puede ser undefined si la cuenta se dio de baja en medio.
    return this.buscarCuenta(id);
  }

  async renombrarCuenta(
    id: string,
    nombre: string,
  ): Promise<CuentaEnAlcance | undefined> {
    await this.db
      .updateTable('tesoreria_cuenta')
      .set({ nombre })
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .execute();
    // Puede ser undefined si la cuenta se dio de baja en medio.
    return this.buscarCuenta(id);
  }

  async eliminarCuenta(id: string): Promise<void> {
    await this.db
      .updateTable('tesoreria_cuenta')
      .set({ deleted_at: sql`now()` })
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .execute();
  }

  async buscarSucursalUsuario(
    usuarioId: string,
  ): Promise<{ id: string | null; codigo: string | null } | undefined> {
    return buscarSucursalUsuario(this.db, usuarioId);
  }

  /** La fecha de hoy en Tijuana, del reloj de Postgres (nunca UTC). */
  async hoyEnTijuana(): Promise<string> {
    const r = await sql<{ hoy: string }>`
      select to_char((now() at time zone 'America/Tijuana')::date, 'YYYY-MM-DD') as hoy
    `.execute(this.db);
    return r.rows[0].hoy;
  }

  /**
   * Saldos fijados VIVOS de esas cuentas (y cuentas vivas), con fecha <= `hasta`
   * si viene. Mas recientes primero.
   */
  async saldosDeCuentas(
    cuentaIds: string[],
    hasta: string | null,
  ): Promise<SaldoFijado[]> {
    if (cuentaIds.length === 0) return [];
    let q = this.db
      .selectFrom('tesoreria_saldo')
      .innerJoin(
        'tesoreria_cuenta',
        'tesoreria_cuenta.id',
        'tesoreria_saldo.cuenta_id',
      )
      .leftJoin('sucursal', 'sucursal.id', 'tesoreria_cuenta.sucursal_id')
      .innerJoin('usuario', 'usuario.id', 'tesoreria_saldo.capturo_usuario_id')
      .select([
        'tesoreria_saldo.id as id',
        'tesoreria_saldo.cuenta_id as cuentaId',
        'tesoreria_cuenta.nombre as cuentaNombre',
        'sucursal.codigo as sucursalCodigo',
        sql<string>`to_char(tesoreria_saldo.fecha, 'YYYY-MM-DD')`.as('fecha'),
        'tesoreria_saldo.monto as monto',
        'tesoreria_saldo.comentario as comentario',
        'usuario.nombre as capturo',
      ])
      .where('tesoreria_saldo.deleted_at', 'is', null)
      .where('tesoreria_cuenta.deleted_at', 'is', null)
      .where('tesoreria_saldo.cuenta_id', 'in', cuentaIds);
    if (hasta !== null)
      q = q.where('tesoreria_saldo.fecha', '<=', sql<Date>`${hasta}::date`);

    const filas = await q
      .orderBy('tesoreria_saldo.fecha', 'desc')
      .orderBy('tesoreria_cuenta.nombre')
      .execute();
    return filas.map(({ monto, ...f }) => ({
      ...f,
      montoCentavos: aCentavos(monto),
    }));
  }

  /**
   * Upsert del lote en UNA transaccion. Primero bloquea las cuentas vivas del
   * lote (`for update`): si alguna ya no esta viva devuelve false y no escribe
   * nada (spec §4.2, todo o nada). El `on conflict` usa el indice parcial
   * `uq_tesoreria_saldo_cuenta_fecha`: misma cuenta y fecha = corregir.
   */
  async guardarSaldos(
    fecha: string,
    filas: {
      cuentaId: string;
      montoCentavos: number;
      comentario: string | null;
    }[],
    usuarioId: string,
  ): Promise<boolean> {
    return this.db.transaction().execute(async (trx) => {
      const ids = filas.map((f) => f.cuentaId);
      const vivas = await trx
        .selectFrom('tesoreria_cuenta')
        .select('id')
        .where('id', 'in', ids)
        .where('deleted_at', 'is', null)
        .forUpdate()
        .execute();
      if (vivas.length !== new Set(ids).size) return false;

      for (const f of filas) {
        await trx
          .insertInto('tesoreria_saldo')
          .values({
            cuenta_id: f.cuentaId,
            fecha,
            monto: aPesos(f.montoCentavos),
            comentario: f.comentario,
            capturo_usuario_id: usuarioId,
          })
          .onConflict((oc) =>
            oc
              .columns(['cuenta_id', 'fecha'])
              .where('deleted_at', 'is', null)
              .doUpdateSet((eb) => ({
                monto: eb.ref('excluded.monto'),
                comentario: eb.ref('excluded.comentario'),
                capturo_usuario_id: eb.ref('excluded.capturo_usuario_id'),
              })),
          )
          .execute();
      }
      return true;
    });
  }

  async buscarSaldo(
    id: string,
  ): Promise<{ id: string; cuentaId: string } | undefined> {
    return this.db
      .selectFrom('tesoreria_saldo')
      .innerJoin(
        'tesoreria_cuenta',
        'tesoreria_cuenta.id',
        'tesoreria_saldo.cuenta_id',
      )
      .select([
        'tesoreria_saldo.id as id',
        'tesoreria_saldo.cuenta_id as cuentaId',
      ])
      .where('tesoreria_saldo.id', '=', id)
      .where('tesoreria_saldo.deleted_at', 'is', null)
      .where('tesoreria_cuenta.deleted_at', 'is', null)
      .executeTakeFirst();
  }

  async eliminarSaldo(id: string): Promise<void> {
    await this.db
      .updateTable('tesoreria_saldo')
      .set({ deleted_at: sql`now()` })
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .execute();
  }
}
