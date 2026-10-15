import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DB_CONNECTION, type Database } from '../../database/database.tokens';
import { buscarSucursalUsuario } from '../sucursales/buscar-sucursal-usuario';
import { ordenarCuentas, type CuentaEnAlcance } from './reglas-saldo';

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
  ): Promise<CuentaEnAlcance> {
    const { id } = await this.db
      .insertInto('tesoreria_cuenta')
      .values({ nombre, sucursal_id: sucursalId })
      .returning('id')
      .executeTakeFirstOrThrow();
    return (await this.buscarCuenta(id))!;
  }

  async renombrarCuenta(id: string, nombre: string): Promise<CuentaEnAlcance> {
    await this.db
      .updateTable('tesoreria_cuenta')
      .set({ nombre })
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .execute();
    return (await this.buscarCuenta(id))!;
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
}
