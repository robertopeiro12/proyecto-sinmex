import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { sql } from 'kysely';
import type { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { OPCIONES_NEST, configurarApp } from './../src/configurar-app';
import { iniciarEnLocal } from './apoyo-servidor';
import {
  DB_CONNECTION,
  type Database,
} from './../src/database/database.tokens';
import { FoliosOficinaAgotados } from './../src/modules/ventas-cobranza/folio-oficina';
import { FoliosOficinaRepository } from './../src/modules/ventas-cobranza/folios-oficina.repository';

/**
 * El contador del folio de oficina contra Postgres de verdad (T-17, §4.4).
 *
 * Lo que solo la base puede demostrar: que el numero no se quema si la venta
 * hace rollback y que dos transacciones a la vez no obtienen el mismo. Fechas
 * de 2024 en MX, exclusivas de este archivo; se limpian antes y despues.
 */
const FECHAS = ['2024-01-01', '2024-01-02', '2024-01-03', '2024-01-04'];

/**
 * `fecha` como `AAAA-MM-DD`: Kysely tipa una columna `date` como `Date` al
 * comparar, y un `Date` de JS se corre de dia segun el huso del proceso.
 */
const fechaComoTexto = sql<string>`to_char(fecha, 'YYYY-MM-DD')`;

describe('FoliosOficinaRepository (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  let repo: FoliosOficinaRepository;
  let sucursal: { id: string; codigo: string };

  const limpiar = () =>
    db
      .deleteFrom('folio_oficina_contador')
      .where('sucursal_id', '=', sucursal.id)
      .where(fechaComoTexto, 'in', FECHAS)
      .execute();

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication(OPCIONES_NEST);
    configurarApp(app);
    await iniciarEnLocal(app);
    db = app.get<Database>(DB_CONNECTION);
    repo = app.get(FoliosOficinaRepository);
    sucursal = await db
      .selectFrom('sucursal')
      .select(['id', 'codigo'])
      .where('codigo', '=', 'MX')
      .executeTakeFirstOrThrow();
    await limpiar();
  });

  afterAll(async () => {
    await limpiar();
    await app.close();
  });

  it('emite 01, 02 en el mismo dia y vuelve a 01 en otro dia', async () => {
    const emitir = (fecha: string) =>
      db.transaction().execute((trx) => repo.emitir(sucursal, fecha, trx));

    expect(await emitir('2024-01-01')).toBe('MX240101OF01');
    expect(await emitir('2024-01-01')).toBe('MX240101OF02');
    expect(await emitir('2024-01-02')).toBe('MX240102OF01');
  });

  it('si la venta hace rollback, el numero no se quema', async () => {
    await expect(
      db.transaction().execute(async (trx) => {
        await repo.emitir(sucursal, '2024-01-03', trx);
        throw new Error('la venta fallo despues de emitir');
      }),
    ).rejects.toThrow('la venta fallo despues de emitir');

    const folio = await db
      .transaction()
      .execute((trx) => repo.emitir(sucursal, '2024-01-03', trx));
    expect(folio).toBe('MX240103OF01');
  });

  it('dos transacciones simultaneas no obtienen el mismo numero', async () => {
    let soltar!: () => void;
    const retenida = new Promise<void>((r) => {
      soltar = r;
    });
    let avisarEmitida!: () => void;
    const emitida = new Promise<void>((r) => {
      avisarEmitida = r;
    });

    // La primera emite y se queda con el candado de la fila sin hacer commit.
    const primera = db.transaction().execute(async (trx) => {
      const folio = await repo.emitir(sucursal, '2024-01-04', trx);
      avisarEmitida();
      await retenida;
      return folio;
    });
    await emitida;

    // La segunda tiene que esperar ese candado; se suelta la primera despues.
    const segunda = db
      .transaction()
      .execute((trx) => repo.emitir(sucursal, '2024-01-04', trx));
    setTimeout(soltar, 200);

    const folios = await Promise.all([primera, segunda]);
    expect(folios.sort()).toEqual(['MX240104OF01', 'MX240104OF02']);
  });

  it('pasado de 99 lanza FoliosOficinaAgotados y el contador no avanza', async () => {
    await db
      .insertInto('folio_oficina_contador')
      .values({ sucursal_id: sucursal.id, fecha: '2024-01-02', ultimo: 99 })
      .onConflict((oc) =>
        oc.columns(['sucursal_id', 'fecha']).doUpdateSet({ ultimo: 99 }),
      )
      .execute();

    await expect(
      db
        .transaction()
        .execute((trx) => repo.emitir(sucursal, '2024-01-02', trx)),
    ).rejects.toBeInstanceOf(FoliosOficinaAgotados);

    const fila = await db
      .selectFrom('folio_oficina_contador')
      .select('ultimo')
      .where('sucursal_id', '=', sucursal.id)
      .where(fechaComoTexto, '=', '2024-01-02')
      .executeTakeFirstOrThrow();
    expect(fila.ultimo).toBe(99);
  });
});
