import { Inject, Injectable } from '@nestjs/common';
import { sql, type Transaction } from 'kysely';
import { DB_CONNECTION, type Database } from '../../database/database.tokens';
import type { DB } from '../../database/schema';
import { aCentavos, aPesos } from '../sincronizacion/dinero';
import { buscarSucursalUsuario } from '../sucursales/buscar-sucursal-usuario';
import type { TipoEgreso } from './tipos-egreso';

/** Una fila de `gasto` lista para escribir. */
export interface NuevoGasto {
  id: string;
  sucursalId: string;
  vendedorId: string | null;
  campoEgresoId: string;
  campoNombre: string;
  tipo: TipoEgreso;
  /** `AAAA-MM-DD`: la `fecha_operacion` del sobre, tal cual. */
  fecha: string;
  registradoEn: string;
  montoCentavos: number;
  metodo: 'efectivo_cobranza_dia';
  origen: 'app' | 'portal';
  quien: string | null;
  comentario: string | null;
}

/** Filtros de `GET /gastos`, ya validados por el servicio. */
export interface FiltroGastos {
  desde: string;
  hasta: string;
  /** `null` = todas las sucursales (usuario General sin filtro). */
  codigoSucursal: string | null;
  vendedorId: string | null;
  campoEgresoId: string | null;
}

/** Un gasto tal como lo ve el portal (camelCase, como el resto de los reportes). */
export interface GastoListado {
  id: string;
  /** `AAAA-MM-DD`: el dia al que cuenta (la `fecha_operacion` del sobre). */
  fecha: string;
  /** ISO: cuando lo grabo el vendedor. La hora de la tabla sale de aqui. */
  registradoEn: string;
  sucursalCodigo: string;
  vendedorId: string | null;
  vendedorNombre: string | null;
  campoEgresoId: string;
  /** La copia del nombre al proyectar (D4), aunque el campo se renombre despues. */
  campoNombre: string;
  tipo: TipoEgreso;
  montoCentavos: number;
  comentario: string | null;
  tieneFoto: boolean;
}

/**
 * SQL de los gastos (T-30/T-31). Lo del push recibe la `trx` y no abre la suya:
 * el gasto entra o sale junto con su fila del buzon (ADR-0009 §2.3).
 */
@Injectable()
export class GastosRepository {
  constructor(@Inject(DB_CONNECTION) private readonly db: Database) {}

  /**
   * Nombre y tipo del campo, para copiarlos al gasto (D4). **Sin mirar
   * `deleted_at`** a proposito (D5): uno dado de baja despues de que el
   * vendedor lo eligio sin red se acepta.
   */
  async campoParaGasto(
    campoId: string,
    trx: Transaction<DB>,
  ): Promise<{ nombre: string; tipo: TipoEgreso } | undefined> {
    const fila = await trx
      .selectFrom('campo_egreso')
      .select(['nombre', 'tipo'])
      .where('id', '=', campoId)
      .executeTakeFirst();
    // El check `ck_campo_egreso_tipo` garantiza uno de los tres.
    return fila
      ? { nombre: fila.nombre, tipo: fila.tipo as TipoEgreso }
      : undefined;
  }

  /** El nombre del vendedor para `gasto.quien`; `null` si ya no existe. */
  async nombreVendedor(
    vendedorId: string,
    trx: Transaction<DB>,
  ): Promise<string | null> {
    const fila = await trx
      .selectFrom('vendedor')
      .select('nombre')
      .where('id', '=', vendedorId)
      .executeTakeFirst();
    return fila?.nombre ?? null;
  }

  /**
   * Inserta el gasto, o devuelve `null` si su id ya estaba ocupado.
   *
   * `on conflict (id) do nothing` y no atrapar el `23505`: un unique_violation
   * aborta la transaccion entera de Postgres (T-16, D10).
   */
  async insertar(
    nuevo: NuevoGasto,
    trx: Transaction<DB>,
  ): Promise<string | null> {
    const fila = await trx
      .insertInto('gasto')
      .values({
        id: nuevo.id,
        sucursal_id: nuevo.sucursalId,
        vendedor_id: nuevo.vendedorId,
        campo_egreso_id: nuevo.campoEgresoId,
        campo_nombre: nuevo.campoNombre,
        tipo: nuevo.tipo,
        // El 'AAAA-MM-DD' del sobre tal cual, sin pasar por Date/UTC.
        fecha: nuevo.fecha,
        registrado_en: nuevo.registradoEn,
        // Centavos enteros a texto exacto: nunca un flotante a `numeric`.
        monto: aPesos(nuevo.montoCentavos),
        metodo: nuevo.metodo,
        origen: nuevo.origen,
        quien: nuevo.quien,
        comentario: nuevo.comentario,
      })
      .onConflict((oc) => oc.column('id').doNothing())
      .returning('id')
      .executeTakeFirst();
    return fila?.id ?? null;
  }

  /** ¿Sigue existiendo ese gasto (vivo)? Antes de escribir su foto en disco. */
  async existe(id: string): Promise<boolean> {
    const fila = await this.db
      .selectFrom('gasto')
      .select('id')
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    return fila !== undefined;
  }

  /**
   * Anota la foto del ticket (nombre y fecha juntos, `ck_gasto_foto_completa`).
   * `false` si la fila ya no estaba o se dio de baja.
   */
  async anotarFoto(
    id: string,
    archivo: string,
    subidaEn: Date,
  ): Promise<boolean> {
    const fila = await this.db
      .updateTable('gasto')
      .set({ foto_archivo: archivo, foto_subida_en: subidaEn })
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .returning('id')
      .executeTakeFirst();
    return fila !== undefined;
  }

  buscarSucursalUsuario(usuarioId: string) {
    return buscarSucursalUsuario(this.db, usuarioId);
  }

  /**
   * Los gastos vivos del rango para el portal (D10). La sucursal es la del
   * GASTO (la del vendedor al proyectar), no la actual del vendedor; el nombre
   * es la copia `quien` guardada al proyectar, no el nombre actual.
   */
  async listar(f: FiltroGastos): Promise<GastoListado[]> {
    const condiciones = [
      sql`g.deleted_at is null`,
      sql`g.fecha between ${f.desde}::date and ${f.hasta}::date`,
    ];
    if (f.codigoSucursal !== null)
      condiciones.push(sql`s.codigo = ${f.codigoSucursal}`);
    if (f.vendedorId !== null)
      condiciones.push(sql`g.vendedor_id = ${f.vendedorId}::uuid`);
    if (f.campoEgresoId !== null)
      condiciones.push(sql`g.campo_egreso_id = ${f.campoEgresoId}::uuid`);

    const filas = await sql<{
      id: string;
      fecha: string;
      registrado_en: Date;
      codigo: string;
      vendedor_id: string | null;
      vendedor_nombre: string | null;
      campo_egreso_id: string;
      campo_nombre: string;
      tipo: string;
      monto: string;
      comentario: string | null;
      tiene_foto: boolean;
    }>`
      select g.id, to_char(g.fecha, 'YYYY-MM-DD') as fecha, g.registrado_en,
             s.codigo, g.vendedor_id,
             g.quien as vendedor_nombre,
             g.campo_egreso_id, g.campo_nombre, g.tipo,
             g.monto::text as monto, g.comentario,
             (g.foto_archivo is not null) as tiene_foto
        from gasto g
        join sucursal s on s.id = g.sucursal_id
       where ${sql.join(condiciones, sql` and `)}
       order by g.fecha, g.registrado_en, g.id
    `.execute(this.db);

    return filas.rows.map((r) => ({
      id: r.id,
      fecha: r.fecha,
      registradoEn: new Date(r.registrado_en).toISOString(),
      sucursalCodigo: r.codigo,
      vendedorId: r.vendedor_id,
      vendedorNombre: r.vendedor_nombre,
      campoEgresoId: r.campo_egreso_id,
      campoNombre: r.campo_nombre,
      // El check `ck_gasto_tipo` garantiza uno de los tres.
      tipo: r.tipo as TipoEgreso,
      montoCentavos: aCentavos(r.monto),
      comentario: r.comentario,
      tieneFoto: r.tiene_foto,
    }));
  }

  /**
   * El archivo de la foto del gasto si esta vivo, tiene foto y es de la
   * sucursal (`null` = General, cualquiera). `null` en todo lo demas: el
   * servicio lo vuelve un 404 sin decir cual de los casos fue.
   */
  async fotoEnAlcance(
    id: string,
    codigoSucursal: string | null,
  ): Promise<string | null> {
    let q = this.db
      .selectFrom('gasto as g')
      .innerJoin('sucursal as s', 's.id', 'g.sucursal_id')
      .select('g.foto_archivo')
      .where('g.id', '=', id)
      .where('g.deleted_at', 'is', null)
      .where('g.foto_archivo', 'is not', null);
    if (codigoSucursal !== null) q = q.where('s.codigo', '=', codigoSucursal);
    const fila = await q.executeTakeFirst();
    return fila?.foto_archivo ?? null;
  }
}
