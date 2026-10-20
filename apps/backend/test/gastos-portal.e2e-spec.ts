// PRIMER import, a proposito: pone FOTOS_DIR antes de que `app.module.ts` lea la configuracion.
import { FOTOS_DIR_PRUEBA } from './apoyo-fotos-dir';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { OPCIONES_NEST, configurarApp } from './../src/configurar-app';
import { iniciarEnLocal } from './apoyo-servidor';
import {
  DB_CONNECTION,
  type Database,
} from './../src/database/database.tokens';
import { PasswordService } from './../src/modules/auth/password.service';

/**
 * T-30/T-31 (D10): Finanzas › Gastos. Fechas de febrero de 2016 a proposito:
 * ninguna otra suite siembra gastos ahi, asi que el total se puede afirmar
 * exacto.
 */
interface Lista {
  desde: string;
  hasta: string;
  totalCentavos: number;
  gastos: {
    id: string;
    fecha: string;
    registradoEn: string;
    sucursalCodigo: string;
    vendedorId: string | null;
    vendedorNombre: string | null;
    campoEgresoId: string;
    campoNombre: string;
    tipo: string;
    montoCentavos: number;
    comentario: string | null;
    tieneFoto: boolean;
  }[];
}

const SUFIJO = `${Date.now()}-${process.pid}`;
const PREFIJO = `ZZ-e2e-gpor-${SUFIJO}`;
const PASSWORD = 'contrasena-de-prueba';
const RANGO = 'desde=2016-02-01&hasta=2016-02-29';

describe('Gastos — consulta del portal (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  const usuarioIds: string[] = [];
  let general: string;
  let tijuana: string;
  let sinPermiso: string;
  let soloVer: string;
  let vendedorTj: string;
  let vendedorMx: string;
  let campoA: string;
  let campoB: string;
  let gastoTjConFoto: string;
  let gastoTjSinFoto: string;
  let gastoMxConFoto: string;

  const http = () => request(app.getHttpServer());

  const iniciarSesion = async (login: string): Promise<string> => {
    const res = await http()
      .post('/auth/login')
      .send({ login, password: PASSWORD })
      .expect(200);
    const cookies = res.headers['set-cookie'] as unknown as string[];
    const acceso = cookies.find((c) => c.startsWith('jawa_access='));
    if (!acceso) throw new Error('El login no devolvio cookie de acceso.');
    return acceso.split(';')[0];
  };

  const crearUsuario = async (
    login: string,
    perfil: string,
    sucursalId: string | null,
  ): Promise<string> => {
    const { id: perfilId } = await db
      .selectFrom('perfil')
      .select('id')
      .where('nombre', '=', perfil)
      .executeTakeFirstOrThrow();
    const { id } = await db
      .insertInto('usuario')
      .values({
        login,
        nombre: login,
        password_hash: await app.get(PasswordService).hashear(PASSWORD),
        perfil_id: perfilId,
        sucursal_id: sucursalId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    usuarioIds.push(id);
    return id;
  };

  const sembrarGasto = async (g: {
    vendedorId: string;
    sucursalId: string;
    campoId: string;
    campoNombre: string;
    fecha: string;
    registradoEn: string;
    monto: string;
    comentario?: string;
    quien?: string;
  }): Promise<string> => {
    const id = randomUUID();
    await db
      .insertInto('gasto')
      .values({
        id,
        sucursal_id: g.sucursalId,
        vendedor_id: g.vendedorId,
        campo_egreso_id: g.campoId,
        campo_nombre: g.campoNombre,
        tipo: 'operacion',
        fecha: g.fecha,
        registrado_en: g.registradoEn,
        monto: g.monto,
        metodo: 'efectivo_cobranza_dia',
        origen: 'app',
        comentario: g.comentario ?? null,
        quien: g.quien ?? null,
      })
      .execute();
    return id;
  };

  /** El archivo en disco y las dos columnas, como lo deja el canal de fotos. */
  const ponerFoto = async (id: string, bytes: Buffer) => {
    const archivo = `gasto-${id}.jpg`;
    await fs.writeFile(join(FOTOS_DIR_PRUEBA, archivo), bytes);
    await db
      .updateTable('gasto')
      .set({ foto_archivo: archivo, foto_subida_en: new Date() })
      .where('id', '=', id)
      .execute();
  };

  const bajarFoto = (id: string, cookie: string) =>
    http()
      .get(`/gastos/${id}/foto`)
      .set('Cookie', cookie)
      .buffer(true)
      .parse((res, fin) => {
        const partes: Buffer[] = [];
        res.on('data', (p: Buffer) => partes.push(p));
        res.on('end', () => fin(null, Buffer.concat(partes)));
      });

  const listar = async (query: string, cookie = general) =>
    (await http().get(`/gastos?${query}`).set('Cookie', cookie).expect(200))
      .body as Lista;

  const JPEG = Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
    Buffer.from('ticket de gasolina', 'utf8'),
    Buffer.from([0xff, 0xd9]),
  ]);

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication(OPCIONES_NEST);
    configurarApp(app);
    await iniciarEnLocal(app);
    db = app.get<Database>(DB_CONNECTION);

    const idTijuana = (
      await db
        .selectFrom('sucursal')
        .select('id')
        .where('codigo', '=', 'TJ')
        .executeTakeFirstOrThrow()
    ).id;
    const idMexicali = (
      await db
        .selectFrom('sucursal')
        .select('id')
        .where('codigo', '=', 'MX')
        .executeTakeFirstOrThrow()
    ).id;

    await crearUsuario(`e2e-gpor-gen-${SUFIJO}`, 'Administrador General', null);
    await crearUsuario(
      `e2e-gpor-tj-${SUFIJO}`,
      'Administrador General',
      idTijuana,
    );
    await crearUsuario(
      `e2e-gpor-sin-${SUFIJO}`,
      'Auxiliar Administrativo',
      null,
    );
    const idSoloVer = await crearUsuario(
      `e2e-gpor-ver-${SUFIJO}`,
      'Auxiliar Administrativo',
      null,
    );
    const { id: permisoVer } = await db
      .selectFrom('permiso')
      .select('id')
      .where('clave', '=', 'gasto.ver')
      .executeTakeFirstOrThrow();
    await db
      .insertInto('usuario_permiso')
      .values({
        usuario_id: idSoloVer,
        permiso_id: permisoVer,
        habilitado: true,
      })
      .execute();

    general = await iniciarSesion(`e2e-gpor-gen-${SUFIJO}`);
    tijuana = await iniciarSesion(`e2e-gpor-tj-${SUFIJO}`);
    sinPermiso = await iniciarSesion(`e2e-gpor-sin-${SUFIJO}`);
    soloVer = await iniciarSesion(`e2e-gpor-ver-${SUFIJO}`);

    const hash = await app.get(PasswordService).hashear(PASSWORD);
    vendedorTj = (
      await db
        .insertInto('vendedor')
        .values({
          login: `e2e-gpor-vtj-${SUFIJO}`,
          nombre: `${PREFIJO} Vendedor TJ`,
          password_hash: hash,
          sucursal_id: idTijuana,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    vendedorMx = (
      await db
        .insertInto('vendedor')
        .values({
          login: `e2e-gpor-vmx-${SUFIJO}`,
          nombre: `${PREFIJO} Vendedor MX`,
          password_hash: hash,
          sucursal_id: idMexicali,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;

    campoA = (
      await db
        .insertInto('campo_egreso')
        .values({
          nombre: `${PREFIJO} Gasolina`,
          tipo: 'operacion',
          se_usa_en_app: true,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    campoB = (
      await db
        .insertInto('campo_egreso')
        .values({
          nombre: `${PREFIJO} Hielo`,
          tipo: 'operacion',
          se_usa_en_app: true,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;

    gastoTjConFoto = await sembrarGasto({
      vendedorId: vendedorTj,
      sucursalId: idTijuana,
      campoId: campoA,
      campoNombre: `${PREFIJO} Gasolina`,
      fecha: '2016-02-03',
      registradoEn: '2016-02-03T17:00:00.000Z',
      monto: '100.00',
      comentario: 'Tanque lleno',
      // La copia del nombre al registrar: distinta del nombre actual del vendedor.
      quien: `${PREFIJO} Nombre al registrar`,
    });
    gastoMxConFoto = await sembrarGasto({
      vendedorId: vendedorMx,
      sucursalId: idMexicali,
      campoId: campoA,
      campoNombre: `${PREFIJO} Gasolina`,
      fecha: '2016-02-03',
      registradoEn: '2016-02-03T18:00:00.000Z',
      monto: '30.00',
    });
    gastoTjSinFoto = await sembrarGasto({
      vendedorId: vendedorTj,
      sucursalId: idTijuana,
      campoId: campoB,
      campoNombre: `${PREFIJO} Hielo`,
      fecha: '2016-02-04',
      registradoEn: '2016-02-04T16:00:00.000Z',
      monto: '50.25',
    });
    const borrado = await sembrarGasto({
      vendedorId: vendedorTj,
      sucursalId: idTijuana,
      campoId: campoA,
      campoNombre: `${PREFIJO} Gasolina`,
      fecha: '2016-02-03',
      registradoEn: '2016-02-03T19:00:00.000Z',
      monto: '999.00',
    });
    await db
      .updateTable('gasto')
      .set({ deleted_at: new Date() })
      .where('id', '=', borrado)
      .execute();
    // Fuera del rango.
    await sembrarGasto({
      vendedorId: vendedorTj,
      sucursalId: idTijuana,
      campoId: campoA,
      campoNombre: `${PREFIJO} Gasolina`,
      fecha: '2016-03-01',
      registradoEn: '2016-03-01T17:00:00.000Z',
      monto: '7.00',
    });

    await ponerFoto(gastoTjConFoto, JPEG);
    await ponerFoto(gastoMxConFoto, JPEG);
  });

  afterAll(async () => {
    // Orden inverso a las llaves foraneas.
    await db
      .deleteFrom('gasto')
      .where('vendedor_id', 'in', [vendedorTj, vendedorMx])
      .execute();
    await db
      .deleteFrom('campo_egreso')
      .where('nombre', 'like', `${PREFIJO}%`)
      .execute();
    await db
      .deleteFrom('vendedor')
      .where('id', 'in', [vendedorTj, vendedorMx])
      .execute();
    if (usuarioIds.length > 0) {
      await db
        .deleteFrom('usuario_permiso')
        .where('usuario_id', 'in', usuarioIds)
        .execute();
      await db
        .deleteFrom('sesion_refresh')
        .where('usuario_id', 'in', usuarioIds)
        .execute();
      await db.deleteFrom('usuario').where('id', 'in', usuarioIds).execute();
    }
    await app.close();
    await fs.rm(FOTOS_DIR_PRUEBA, { recursive: true, force: true });
  });

  describe('GET /gastos', () => {
    it('un General ve los vivos del rango de todas las sucursales, en orden, con el total', async () => {
      const r = await listar(RANGO);
      expect(r.gastos.map((g) => g.id)).toEqual([
        gastoTjConFoto,
        gastoMxConFoto,
        gastoTjSinFoto,
      ]);
      expect(r.totalCentavos).toBe(18_025);
      expect(r.gastos[0]).toEqual({
        id: gastoTjConFoto,
        fecha: '2016-02-03',
        registradoEn: '2016-02-03T17:00:00.000Z',
        sucursalCodigo: 'TJ',
        vendedorId: vendedorTj,
        vendedorNombre: `${PREFIJO} Nombre al registrar`,
        campoEgresoId: campoA,
        campoNombre: `${PREFIJO} Gasolina`,
        tipo: 'operacion',
        montoCentavos: 10_000,
        comentario: 'Tanque lleno',
        tieneFoto: true,
      });
      expect(r.gastos[2]).toMatchObject({ tieneFoto: false, comentario: null });
    });

    it('filtra por sucursal, por vendedor y por campo', async () => {
      const tj = await listar(`${RANGO}&sucursal=TJ`);
      expect(tj.gastos.map((g) => g.id)).toEqual([
        gastoTjConFoto,
        gastoTjSinFoto,
      ]);
      expect(tj.totalCentavos).toBe(15_025);

      const mx = await listar(`${RANGO}&vendedor=${vendedorMx}`);
      expect(mx.gastos.map((g) => g.id)).toEqual([gastoMxConFoto]);

      const hielo = await listar(`${RANGO}&campo=${campoB}`);
      expect(hielo.gastos.map((g) => g.id)).toEqual([gastoTjSinFoto]);
      expect(hielo.totalCentavos).toBe(5_025);
    });

    it('un usuario atado a TJ ve solo TJ y pedir MX es 403', async () => {
      const r = await listar(RANGO, tijuana);
      expect(r.gastos.every((g) => g.sucursalCodigo === 'TJ')).toBe(true);
      expect(r.totalCentavos).toBe(15_025);
      await http()
        .get(`/gastos?${RANGO}&sucursal=MX`)
        .set('Cookie', tijuana)
        .expect(403);
    });

    it('un rango de mas de 366 dias, un formato malo o un vendedor que no es uuid es 400', async () => {
      await http()
        .get('/gastos?desde=2015-01-01&hasta=2016-02-29')
        .set('Cookie', general)
        .expect(400);
      await http()
        .get('/gastos?desde=01/02/2016&hasta=2016-02-29')
        .set('Cookie', general)
        .expect(400);
      const res = await http()
        .get(`/gastos?${RANGO}&vendedor=oficina`)
        .set('Cookie', general)
        .expect(400);
      expect((res.body as { message: string }).message).toBe(
        'El vendedor no es válido.',
      );
    });

    it('sin gasto.ver es 403; con solo ese permiso entra', async () => {
      await http()
        .get(`/gastos?${RANGO}`)
        .set('Cookie', sinPermiso)
        .expect(403);
      const r = await listar(RANGO, soloVer);
      expect(r.totalCentavos).toBe(18_025);
    });

    it('sin sesion es 401', async () => {
      await http().get(`/gastos?${RANGO}`).expect(401);
    });
  });

  describe('GET /gastos/:id/foto', () => {
    it('sirve el JPEG del ticket con cache privado', async () => {
      const res = await bajarFoto(gastoTjConFoto, general).expect(200);
      expect(res.headers['content-type']).toMatch(/image\/jpeg/);
      expect(res.headers['cache-control']).toBe('private, max-age=300');
      expect(res.body).toEqual(JPEG);
    });

    it('la foto de un gasto de otra sucursal es 404, no 403', async () => {
      await bajarFoto(gastoMxConFoto, tijuana).expect(404);
      await bajarFoto(gastoTjConFoto, tijuana).expect(200);
    });

    it('un gasto sin foto o que no existe es 404', async () => {
      await bajarFoto(gastoTjSinFoto, general).expect(404);
      await bajarFoto(randomUUID(), general).expect(404);
    });

    it('sin gasto.ver es 403', async () => {
      await bajarFoto(gastoTjConFoto, sinPermiso).expect(403);
    });
  });
});
