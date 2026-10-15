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

interface Cuenta {
  id: string;
  nombre: string;
  sucursalId: string | null;
  sucursalCodigo: string | null;
}

// PID + timestamp: Jest corre suites en paralelo (ver vehiculos.e2e-spec.ts).
const SUFIJO = `${Date.now()}-${process.pid}`;
const PREFIJO = `ZZ-e2e-teso-${SUFIJO}`;
const PASSWORD = 'contrasena-de-prueba';
const LOGIN_GENERAL = `e2e-teso-gen-${SUFIJO}`;
const LOGIN_TIJUANA = `e2e-teso-tj-${SUFIJO}`;
const LOGIN_SOLO_VER = `e2e-teso-ver-${SUFIJO}`;
const LOGIN_SIN = `e2e-teso-sin-${SUFIJO}`;

describe('Tesorería (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  const usuarioIds: string[] = [];
  let idTijuana: string;
  let idMexicali: string;
  let general: string;
  let tijuana: string;
  let soloVer: string;
  let sin: string;

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
    const hash = await app.get(PasswordService).hashear(PASSWORD);
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
        password_hash: hash,
        perfil_id: perfilId,
        sucursal_id: sucursalId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    usuarioIds.push(id);
    return id;
  };

  /** Siembra una cuenta por debajo de la API. */
  const sembrarCuenta = async (
    nombre: string,
    sucursalId: string | null,
  ): Promise<string> => {
    const { id } = await db
      .insertInto('tesoreria_cuenta')
      .values({ nombre: `${PREFIJO} ${nombre}`, sucursal_id: sucursalId })
      .returning('id')
      .executeTakeFirstOrThrow();
    return id;
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication(OPCIONES_NEST);
    configurarApp(app);
    await iniciarEnLocal(app);
    db = app.get<Database>(DB_CONNECTION);

    idTijuana = (
      await db
        .selectFrom('sucursal')
        .select('id')
        .where('codigo', '=', 'TJ')
        .executeTakeFirstOrThrow()
    ).id;
    idMexicali = (
      await db
        .selectFrom('sucursal')
        .select('id')
        .where('codigo', '=', 'MX')
        .executeTakeFirstOrThrow()
    ).id;

    await crearUsuario(LOGIN_GENERAL, 'Administrador General', null);
    await crearUsuario(LOGIN_TIJUANA, 'Administrador General', idTijuana);
    const idSoloVer = await crearUsuario(
      LOGIN_SOLO_VER,
      'Auxiliar Administrativo',
      null,
    );
    await crearUsuario(LOGIN_SIN, 'Auxiliar Administrativo', null);

    // Excepcion que concede solo `tesoreria.ver` (usuario_permiso, T-08a).
    const { id: permisoVer } = await db
      .selectFrom('permiso')
      .select('id')
      .where('clave', '=', 'tesoreria.ver')
      .executeTakeFirstOrThrow();
    await db
      .insertInto('usuario_permiso')
      .values({
        usuario_id: idSoloVer,
        permiso_id: permisoVer,
        habilitado: true,
      })
      .execute();

    general = await iniciarSesion(LOGIN_GENERAL);
    tijuana = await iniciarSesion(LOGIN_TIJUANA);
    soloVer = await iniciarSesion(LOGIN_SOLO_VER);
    sin = await iniciarSesion(LOGIN_SIN);
  });

  afterAll(async () => {
    const cuentas = db
      .selectFrom('tesoreria_cuenta')
      .select('id')
      .where('nombre', 'like', `${PREFIJO}%`);
    await db
      .deleteFrom('tesoreria_saldo')
      .where('cuenta_id', 'in', cuentas)
      .execute();
    await db
      .deleteFrom('tesoreria_cuenta')
      .where('nombre', 'like', `${PREFIJO}%`)
      .execute();
    if (usuarioIds.length > 0) {
      await db
        .deleteFrom('tesoreria_saldo')
        .where('capturo_usuario_id', 'in', usuarioIds)
        .execute();
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
  });

  describe('cuentas', () => {
    it('un General crea una cuenta general y otra de Mexicali; el nombre se recorta', async () => {
      const g = await http()
        .post('/tesoreria/cuentas')
        .set('Cookie', general)
        .send({ nombre: `  ${PREFIJO} Banco  ` })
        .expect(201);
      expect(g.body as Cuenta).toEqual({
        id: expect.any(String) as string,
        nombre: `${PREFIJO} Banco`,
        sucursalId: null,
        sucursalCodigo: null,
      });

      const mx = await http()
        .post('/tesoreria/cuentas')
        .set('Cookie', general)
        .send({ nombre: `${PREFIJO} Efectivo MX`, sucursalId: idMexicali })
        .expect(201);
      expect(mx.body).toMatchObject({
        sucursalId: idMexicali,
        sucursalCodigo: 'MX',
      });
    });

    it('un usuario de Tijuana crea en SU sucursal aunque mande otra', async () => {
      const r = await http()
        .post('/tesoreria/cuentas')
        .set('Cookie', tijuana)
        .send({ nombre: `${PREFIJO} Efectivo TJ`, sucursalId: idMexicali })
        .expect(201);
      expect(r.body).toMatchObject({
        sucursalId: idTijuana,
        sucursalCodigo: 'TJ',
      });
    });

    it('nombre repetido (mayúsculas y espacios aparte) es 409, al crear y al renombrar', async () => {
      await sembrarCuenta('Repetida', null);
      const r = await http()
        .post('/tesoreria/cuentas')
        .set('Cookie', general)
        .send({ nombre: ` ${PREFIJO} REPETIDA ` })
        .expect(409);
      expect((r.body as { message: string }).message).toBe(
        'Ya existe una cuenta con ese nombre.',
      );

      const otra = await sembrarCuenta('Otra', null);
      await http()
        .patch(`/tesoreria/cuentas/${otra}`)
        .set('Cookie', general)
        .send({ nombre: `${PREFIJO} repetida` })
        .expect(409);
    });

    it('nombre vacío o de más de 60 caracteres es 400', async () => {
      await http()
        .post('/tesoreria/cuentas')
        .set('Cookie', general)
        .send({ nombre: '   ' })
        .expect(400);
      await http()
        .post('/tesoreria/cuentas')
        .set('Cookie', general)
        .send({ nombre: 'x'.repeat(61) })
        .expect(400);
    });

    it('una sucursal que no existe es 400', async () => {
      await http()
        .post('/tesoreria/cuentas')
        .set('Cookie', general)
        .send({
          nombre: `${PREFIJO} Fantasma`,
          sucursalId: '00000000-0000-4000-8000-000000000000',
        })
        .expect(400);
    });

    it('Tijuana lista las suyas y las generales, no las de Mexicali', async () => {
      const tj = await sembrarCuenta('Lista TJ', idTijuana);
      const mx = await sembrarCuenta('Lista MX', idMexicali);
      const gen = await sembrarCuenta('Lista General', null);
      const r = await http()
        .get('/tesoreria/cuentas')
        .set('Cookie', tijuana)
        .expect(200);
      const ids = (r.body as Cuenta[]).map((c) => c.id);
      expect(ids).toEqual(expect.arrayContaining([tj, gen]));
      expect(ids).not.toContain(mx);
    });

    it('un General con ?sucursal=MX ve las de MX y las generales', async () => {
      const mx = await sembrarCuenta('Filtro MX', idMexicali);
      const tj = await sembrarCuenta('Filtro TJ', idTijuana);
      const r = await http()
        .get('/tesoreria/cuentas?sucursal=MX')
        .set('Cookie', general)
        .expect(200);
      const ids = (r.body as Cuenta[]).map((c) => c.id);
      expect(ids).toContain(mx);
      expect(ids).not.toContain(tj);
      expect(
        (r.body as Cuenta[]).every(
          (c) => c.sucursalCodigo === null || c.sucursalCodigo === 'MX',
        ),
      ).toBe(true);
    });

    it('Tijuana: una cuenta de Mexicali es 404 y una general es 403', async () => {
      const mx = await sembrarCuenta('Ajena MX', idMexicali);
      const gen = await sembrarCuenta('Ajena General', null);
      await http()
        .patch(`/tesoreria/cuentas/${mx}`)
        .set('Cookie', tijuana)
        .send({ nombre: `${PREFIJO} X` })
        .expect(404);
      await http()
        .delete(`/tesoreria/cuentas/${mx}`)
        .set('Cookie', tijuana)
        .expect(404);
      const r = await http()
        .patch(`/tesoreria/cuentas/${gen}`)
        .set('Cookie', tijuana)
        .send({ nombre: `${PREFIJO} Y` })
        .expect(403);
      expect((r.body as { message: string }).message).toBe(
        'Las cuentas generales solo las administra un usuario General.',
      );
      await http()
        .delete(`/tesoreria/cuentas/${gen}`)
        .set('Cookie', tijuana)
        .expect(403);
    });

    it('renombrar y dar de baja; la baja libera el nombre y la cuenta deja de listarse', async () => {
      const id = await sembrarCuenta('Vieja', idTijuana);
      const r = await http()
        .patch(`/tesoreria/cuentas/${id}`)
        .set('Cookie', tijuana)
        .send({ nombre: `${PREFIJO} Nueva` })
        .expect(200);
      expect(r.body).toMatchObject({
        id,
        nombre: `${PREFIJO} Nueva`,
        sucursalCodigo: 'TJ',
      });

      await http()
        .delete(`/tesoreria/cuentas/${id}`)
        .set('Cookie', tijuana)
        .expect(200, { id });
      const lista = await http()
        .get('/tesoreria/cuentas')
        .set('Cookie', tijuana)
        .expect(200);
      expect((lista.body as Cuenta[]).map((c) => c.id)).not.toContain(id);
      await http()
        .delete(`/tesoreria/cuentas/${id}`)
        .set('Cookie', tijuana)
        .expect(404);

      await http()
        .post('/tesoreria/cuentas')
        .set('Cookie', tijuana)
        .send({ nombre: `${PREFIJO} Nueva` })
        .expect(201);
    });

    it('sin tesoreria.gestionar todo es 403 (solo-ver incluido)', async () => {
      for (const cookie of [soloVer, sin]) {
        await http()
          .get('/tesoreria/cuentas')
          .set('Cookie', cookie)
          .expect(403);
        await http()
          .post('/tesoreria/cuentas')
          .set('Cookie', cookie)
          .send({ nombre: `${PREFIJO} No` })
          .expect(403);
      }
    });
  });

  describe('saldos', () => {
    interface SaldosDelDia {
      fecha: string;
      cuentas: {
        cuentaId: string;
        nombre: string;
        sucursalCodigo: string | null;
        saldo: {
          id: string;
          montoCentavos: number;
          comentario: string | null;
        } | null;
      }[];
      saldos: {
        id: string;
        cuentaId: string;
        fecha: string;
        montoCentavos: number;
        comentario: string | null;
        capturo: string;
      }[];
    }

    it('guarda en lote, corrige en vez de duplicar y acepta negativos', async () => {
      const a = await sembrarCuenta('Saldo A', idTijuana);
      const b = await sembrarCuenta('Saldo B', null);

      await http()
        .put('/tesoreria/saldos')
        .set('Cookie', general)
        .send({
          fecha: '2026-10-01',
          saldos: [
            { cuentaId: a, montoCentavos: 1_000_000, comentario: ' Arranque ' },
            { cuentaId: b, montoCentavos: -150_050 },
          ],
        })
        .expect(200, { guardados: 2 });

      await http()
        .put('/tesoreria/saldos')
        .set('Cookie', general)
        .send({
          fecha: '2026-10-01',
          saldos: [{ cuentaId: a, montoCentavos: 999_900, comentario: '' }],
        })
        .expect(200, { guardados: 1 });

      const r = await http()
        .get('/tesoreria/saldos?fecha=2026-10-01')
        .set('Cookie', general)
        .expect(200);
      const cuerpo = r.body as SaldosDelDia;
      expect(cuerpo.fecha).toBe('2026-10-01');
      expect(cuerpo.cuentas.find((c) => c.cuentaId === a)?.saldo).toEqual({
        id: expect.any(String) as string,
        montoCentavos: 999_900,
        comentario: null,
      });
      expect(cuerpo.cuentas.find((c) => c.cuentaId === b)?.saldo).toMatchObject(
        { montoCentavos: -150_050 },
      );
      expect(cuerpo.saldos.filter((s) => s.cuentaId === a)).toHaveLength(1);
      expect(cuerpo.saldos.find((s) => s.cuentaId === a)).toMatchObject({
        fecha: '2026-10-01',
        capturo: LOGIN_GENERAL,
      });
    });

    it('fecha futura es 400; fecha inexistente es 400', async () => {
      const a = await sembrarCuenta('Futura', idTijuana);
      const r = await http()
        .put('/tesoreria/saldos')
        .set('Cookie', general)
        .send({
          fecha: '2999-01-01',
          saldos: [{ cuentaId: a, montoCentavos: 1 }],
        })
        .expect(400);
      expect((r.body as { message: string }).message).toBe(
        'No se puede fijar un saldo en una fecha futura.',
      );
      await http()
        .put('/tesoreria/saldos')
        .set('Cookie', general)
        .send({
          fecha: '2026-02-30',
          saldos: [{ cuentaId: a, montoCentavos: 1 }],
        })
        .expect(400);
    });

    it('montos con decimales o la misma cuenta dos veces son 400', async () => {
      const a = await sembrarCuenta('Forma', idTijuana);
      await http()
        .put('/tesoreria/saldos')
        .set('Cookie', general)
        .send({
          fecha: '2026-10-02',
          saldos: [{ cuentaId: a, montoCentavos: 10.5 }],
        })
        .expect(400);
      const r = await http()
        .put('/tesoreria/saldos')
        .set('Cookie', general)
        .send({
          fecha: '2026-10-02',
          saldos: [
            { cuentaId: a, montoCentavos: 1 },
            { cuentaId: a, montoCentavos: 2 },
          ],
        })
        .expect(400);
      expect((r.body as { message: string }).message).toBe(
        'Una cuenta viene dos veces en el lote.',
      );
    });

    it('el lote es todo o nada: una cuenta ajena o borrada tumba también las válidas', async () => {
      const propia = await sembrarCuenta('Lote propia', idTijuana);
      const ajena = await sembrarCuenta('Lote ajena', idMexicali);
      await http()
        .put('/tesoreria/saldos')
        .set('Cookie', tijuana)
        .send({
          fecha: '2026-10-03',
          saldos: [
            { cuentaId: propia, montoCentavos: 100 },
            { cuentaId: ajena, montoCentavos: 200 },
          ],
        })
        .expect(404);

      const borrada = await sembrarCuenta('Lote borrada', idTijuana);
      await db
        .updateTable('tesoreria_cuenta')
        .set({ deleted_at: new Date() })
        .where('id', '=', borrada)
        .execute();
      await http()
        .put('/tesoreria/saldos')
        .set('Cookie', tijuana)
        .send({
          fecha: '2026-10-03',
          saldos: [
            { cuentaId: propia, montoCentavos: 100 },
            { cuentaId: borrada, montoCentavos: 200 },
          ],
        })
        .expect(404);

      const n = await db
        .selectFrom('tesoreria_saldo')
        .select(db.fn.countAll<string>().as('n'))
        .where('cuenta_id', '=', propia)
        .executeTakeFirstOrThrow();
      expect(Number(n.n)).toBe(0);
    });

    it('Tijuana no fija saldo a una cuenta general (403) y la pestaña Saldos no se la ofrece', async () => {
      const gen = await sembrarCuenta('Saldo general', null);
      const r = await http()
        .put('/tesoreria/saldos')
        .set('Cookie', tijuana)
        .send({
          fecha: '2026-10-04',
          saldos: [{ cuentaId: gen, montoCentavos: 1 }],
        })
        .expect(403);
      expect((r.body as { message: string }).message).toBe(
        'Las cuentas generales solo las administra un usuario General.',
      );

      const dia = await http()
        .get('/tesoreria/saldos?fecha=2026-10-04')
        .set('Cookie', tijuana)
        .expect(200);
      expect(
        (dia.body as SaldosDelDia).cuentas.map((c) => c.cuentaId),
      ).not.toContain(gen);
    });

    it('eliminar un saldo fijado: 200, luego 404; Tijuana no borra el de una general', async () => {
      const a = await sembrarCuenta('Borrar saldo', idTijuana);
      const gen = await sembrarCuenta('Borrar saldo general', null);
      await http()
        .put('/tesoreria/saldos')
        .set('Cookie', general)
        .send({
          fecha: '2026-10-05',
          saldos: [
            { cuentaId: a, montoCentavos: 5 },
            { cuentaId: gen, montoCentavos: 6 },
          ],
        })
        .expect(200);
      const dia = (
        await http()
          .get('/tesoreria/saldos?fecha=2026-10-05')
          .set('Cookie', general)
          .expect(200)
      ).body as SaldosDelDia;
      const idA = dia.cuentas.find((c) => c.cuentaId === a)!.saldo!.id;
      const idGen = dia.cuentas.find((c) => c.cuentaId === gen)!.saldo!.id;

      await http()
        .delete(`/tesoreria/saldos/${idGen}`)
        .set('Cookie', tijuana)
        .expect(403);
      await http()
        .delete(`/tesoreria/saldos/${idA}`)
        .set('Cookie', tijuana)
        .expect(200, { id: idA });
      await http()
        .delete(`/tesoreria/saldos/${idA}`)
        .set('Cookie', tijuana)
        .expect(404);
    });

    it('sin tesoreria.gestionar los saldos son 403', async () => {
      await http()
        .get('/tesoreria/saldos?fecha=2026-10-01')
        .set('Cookie', soloVer)
        .expect(403);
      await http()
        .put('/tesoreria/saldos')
        .set('Cookie', soloVer)
        .send({ fecha: '2026-10-01', saldos: [] })
        .expect(403);
    });
  });

  describe('vista', () => {
    interface Vista {
      desde: string;
      hasta: string;
      cuentas: {
        id: string;
        nombre: string;
        sucursalCodigo: string | null;
        saldoInicioCentavos: number | null;
        saldoFinalCentavos: number | null;
      }[];
      total: {
        saldoInicioCentavos: number;
        saldoFinalCentavos: number;
        cuentasConSaldoInicio: number;
        cuentasConSaldoFinal: number;
        cuentas: number;
      };
      eventos: {
        tipo: string;
        id: string;
        fecha: string;
        cuentaId: string;
        montoCentavos: number;
        comentario: string | null;
        capturo: string;
      }[];
    }

    it('el ejemplo del spec, y un saldo fijado al día siguiente no cambia el final', async () => {
      const a = await sembrarCuenta('Vista A', idTijuana);
      await http()
        .put('/tesoreria/saldos')
        .set('Cookie', general)
        .send({
          fecha: '2026-09-01',
          saldos: [{ cuentaId: a, montoCentavos: 1_000_000 }],
        })
        .expect(200);
      await http()
        .put('/tesoreria/saldos')
        .set('Cookie', general)
        .send({
          fecha: '2026-09-10',
          saldos: [
            { cuentaId: a, montoCentavos: 950_000, comentario: 'Arqueo' },
          ],
        })
        .expect(200);
      await http()
        .put('/tesoreria/saldos')
        .set('Cookie', general)
        .send({
          fecha: '2026-09-13',
          saldos: [{ cuentaId: a, montoCentavos: 1 }],
        })
        .expect(200);

      const r = await http()
        .get('/tesoreria?desde=2026-09-05&hasta=2026-09-12&sucursal=TJ')
        .set('Cookie', soloVer)
        .expect(200);
      const v = r.body as Vista;
      expect(v.cuentas.find((c) => c.id === a)).toMatchObject({
        saldoInicioCentavos: 1_000_000,
        saldoFinalCentavos: 950_000,
      });
      const evento = v.eventos.find((e) => e.cuentaId === a);
      expect(evento).toMatchObject({
        tipo: 'saldo-fijado',
        fecha: '2026-09-10',
        montoCentavos: 950_000,
        comentario: 'Arqueo',
        capturo: LOGIN_GENERAL,
      });
      expect(v.eventos.filter((e) => e.cuentaId === a)).toHaveLength(1);
      expect(v.total.cuentas).toBe(v.cuentas.length);
    });

    it('cuenta sin saldo antes del rango sale con null; las de Mexicali no salen en TJ', async () => {
      const tj = await sembrarCuenta('Vista sin saldo', idTijuana);
      const mx = await sembrarCuenta('Vista MX', idMexicali);
      const r = await http()
        .get('/tesoreria?desde=2026-09-01&hasta=2026-09-01')
        .set('Cookie', tijuana)
        .expect(200);
      const v = r.body as Vista;
      expect(v.cuentas.find((c) => c.id === tj)).toMatchObject({
        saldoInicioCentavos: null,
        saldoFinalCentavos: null,
      });
      expect(v.cuentas.map((c) => c.id)).not.toContain(mx);
    });

    it('una cuenta dada de baja no aparece', async () => {
      const id = await sembrarCuenta('Vista baja', idTijuana);
      await http()
        .delete(`/tesoreria/cuentas/${id}`)
        .set('Cookie', general)
        .expect(200);
      const r = await http()
        .get('/tesoreria?desde=2026-09-01&hasta=2026-09-30')
        .set('Cookie', general)
        .expect(200);
      expect((r.body as Vista).cuentas.map((c) => c.id)).not.toContain(id);
    });

    it('rango inválido o de más de un año es 400; sin permiso es 403; Tijuana pidiendo MX es 403', async () => {
      await http()
        .get('/tesoreria?desde=2026-09-10&hasta=2026-09-01')
        .set('Cookie', general)
        .expect(400);
      await http()
        .get('/tesoreria?desde=2025-01-01&hasta=2026-09-01')
        .set('Cookie', general)
        .expect(400);
      await http()
        .get('/tesoreria?desde=2026-09-01')
        .set('Cookie', general)
        .expect(400);
      await http()
        .get('/tesoreria?desde=2026-09-01&hasta=2026-09-01')
        .set('Cookie', sin)
        .expect(403);
      await http()
        .get('/tesoreria?desde=2026-09-01&hasta=2026-09-01&sucursal=MX')
        .set('Cookie', tijuana)
        .expect(403);
    });
  });
});
