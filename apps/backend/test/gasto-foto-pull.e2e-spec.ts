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
import {
  CONTRATO_ACTUAL,
  type RespuestaPull,
  type RespuestaPush,
} from './../src/modules/sincronizacion/contrato';

/**
 * T-30/T-31: el catalogo de campos de egreso baja en el pull (D6) y la foto del
 * ticket sube por el canal de fotos como `gasto-<id>.jpg` (D8). El push del
 * gasto en si lo prueba `gasto.e2e-spec.ts` (Tarea 3).
 */
const SUFIJO = `${Date.now()}-${process.pid}`;
const LOGIN = `e2e-gfoto-${SUFIJO}`;
const LOGIN_AJENO = `e2e-gfoto-a-${SUFIJO}`;
const PASSWORD = 'contrasena-del-vendedor';
const PREFIJO = `ZZ-gfoto-${SUFIJO}`;
const FECHA = '2026-10-20';

describe('Gastos: pull del catalogo y foto del ticket (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;

  let vendedorId: string;
  let vendedorAjenoId: string;
  let campoId: string;
  let campoBorradoId: string;
  let bearer: string;
  let bearerAjeno: string;

  const push = async (operaciones: unknown[], token = bearer) => {
    const res = await request(app.getHttpServer())
      .post('/sync/push')
      .set('Authorization', `Bearer ${token}`)
      .send({ contrato: CONTRATO_ACTUAL, operaciones })
      .expect(200);
    return res.body as RespuestaPush;
  };

  const pull = async (desde?: string) => {
    const params = new URLSearchParams({ contrato: String(CONTRATO_ACTUAL) });
    if (desde) params.set('desde', desde);
    const res = await request(app.getHttpServer())
      .get(`/sync/pull?${params.toString()}`)
      .set('Authorization', `Bearer ${bearer}`)
      .expect(200);
    return res.body as RespuestaPull;
  };

  const gasto = (datos: Record<string, unknown> = {}) => ({
    clave: randomUUID(),
    tipo: 'gasto',
    fecha_operacion: FECHA,
    ocurrido_en: `${FECHA}T18:40:00.000Z`,
    datos: {
      campo_egreso_id: campoId,
      monto_centavos: 8000,
      registrado_en: `${FECHA}T18:40:00.000Z`,
      comentario: null,
      ...datos,
    },
  });

  const jpeg = (relleno = 'ticket'): Buffer =>
    Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
      Buffer.from(relleno, 'utf8'),
      Buffer.from([0xff, 0xd9]),
    ]);

  const subirFoto = (clave: string, cuerpo: Buffer, token = bearer) =>
    request(app.getHttpServer())
      .post(`/sync/foto/${clave}`)
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'image/jpeg')
      .send(cuerpo);

  const archivos = async (id: string) =>
    (await fs.readdir(FOTOS_DIR_PRUEBA)).filter((n) => n.includes(id));

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication(OPCIONES_NEST);
    configurarApp(app);
    await iniciarEnLocal(app);
    db = app.get<Database>(DB_CONNECTION);

    const sucursales = await db
      .selectFrom('sucursal')
      .select('id')
      .where('deleted_at', 'is', null)
      .orderBy('codigo')
      .limit(2)
      .execute();
    expect(sucursales.length).toBeGreaterThanOrEqual(2);

    const hash = await new PasswordService().hashear(PASSWORD);
    vendedorId = (
      await db
        .insertInto('vendedor')
        .values({
          login: LOGIN,
          nombre: 'Vendedor de gastos',
          password_hash: hash,
          sucursal_id: sucursales[0].id,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    vendedorAjenoId = (
      await db
        .insertInto('vendedor')
        .values({
          login: LOGIN_AJENO,
          nombre: 'Vendedor de otra sucursal',
          password_hash: hash,
          sucursal_id: sucursales[1].id,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;

    campoId = (
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
    campoBorradoId = (
      await db
        .insertInto('campo_egreso')
        .values({
          nombre: `${PREFIJO} Viejo`,
          tipo: 'financiero',
          deleted_at: new Date(),
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;

    const login = await request(app.getHttpServer())
      .post('/auth/app/login')
      .send({ login: LOGIN, password: PASSWORD })
      .expect(200);
    bearer = (login.body as { tokenAcceso: string }).tokenAcceso;
    const loginAjeno = await request(app.getHttpServer())
      .post('/auth/app/login')
      .send({ login: LOGIN_AJENO, password: PASSWORD })
      .expect(200);
    bearerAjeno = (loginAjeno.body as { tokenAcceso: string }).tokenAcceso;
  });

  afterAll(async () => {
    // Orden inverso a las llaves foraneas.
    await db
      .deleteFrom('gasto')
      .where('vendedor_id', 'in', [vendedorId, vendedorAjenoId])
      .execute();
    await db
      .deleteFrom('sync_operacion')
      .where('vendedor_id', 'in', [vendedorId, vendedorAjenoId])
      .execute();
    await db
      .deleteFrom('campo_egreso')
      .where('nombre', 'like', `${PREFIJO}%`)
      .execute();
    await db
      .deleteFrom('sesion_vendedor')
      .where('vendedor_id', 'in', [vendedorId, vendedorAjenoId])
      .execute();
    await db
      .deleteFrom('vendedor')
      .where('id', 'in', [vendedorId, vendedorAjenoId])
      .execute();
    await app.close();
    await fs.rm(FOTOS_DIR_PRUEBA, { recursive: true, force: true });
  });

  describe('pull (D6)', () => {
    it('el pull completo trae la semilla con su tipo y casilla, y la baja como activo 0', async () => {
      const { catalogos } = await pull();
      const porNombre = new Map(
        catalogos.campos_egreso.map((c) => [c.nombre, c]),
      );
      expect(porNombre.get('Gasolina')).toMatchObject({
        tipo: 'operacion',
        se_usa_en_app: true,
        activo: 1,
      });
      expect(porNombre.get('Envases')).toMatchObject({
        tipo: 'produccion',
        se_usa_en_app: false,
        activo: 1,
      });
      expect(porNombre.get(`${PREFIJO} Hielo`)).toMatchObject({
        id: campoId,
        se_usa_en_app: true,
        activo: 1,
      });
      expect(porNombre.get(`${PREFIJO} Viejo`)).toMatchObject({
        id: campoBorradoId,
        tipo: 'financiero',
        activo: 0,
      });
    });

    it('apagar la casilla y dar de baja un campo bajan en el pull incremental', async () => {
      const { id } = await db
        .insertInto('campo_egreso')
        .values({
          nombre: `${PREFIJO} Casetas`,
          tipo: 'operacion',
          se_usa_en_app: true,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      const { cursor } = await pull();

      // El trigger `set_actualizado_en` mueve la columna por la que corta el pull.
      await db
        .updateTable('campo_egreso')
        .set({ se_usa_en_app: false })
        .where('id', '=', id)
        .execute();
      const apagado = await pull(cursor);
      expect(
        apagado.catalogos.campos_egreso.find((c) => c.id === id),
      ).toMatchObject({ se_usa_en_app: false, activo: 1 });

      await db
        .updateTable('campo_egreso')
        .set({ deleted_at: new Date() })
        .where('id', '=', id)
        .execute();
      const baja = await pull(apagado.cursor);
      expect(
        baja.catalogos.campos_egreso.find((c) => c.id === id),
      ).toMatchObject({ activo: 0 });
    });
  });

  describe('foto del ticket (D8)', () => {
    it('la foto de un gasto aplicado se guarda como gasto-<id>.jpg y se anota en el gasto', async () => {
      const op = gasto();
      expect((await push([op])).resultados[0].estado).toBe('aplicada');
      const bytes = jpeg('ticket de hielo');

      const res = await subirFoto(op.clave, bytes).expect(200);
      expect(res.body).toMatchObject({ clave: op.clave });
      expect(await archivos(op.clave)).toEqual([`gasto-${op.clave}.jpg`]);
      expect(
        await fs.readFile(join(FOTOS_DIR_PRUEBA, `gasto-${op.clave}.jpg`)),
      ).toEqual(bytes);
      const fila = await db
        .selectFrom('gasto')
        .select(['foto_archivo', 'foto_subida_en'])
        .where('id', '=', op.clave)
        .executeTakeFirstOrThrow();
      expect(fila.foto_archivo).toBe(`gasto-${op.clave}.jpg`);
      expect(fila.foto_subida_en).not.toBeNull();
    });

    it('subir dos veces la foto del mismo gasto deja un solo archivo (Review Focus)', async () => {
      const op = gasto();
      expect((await push([op])).resultados[0].estado).toBe('aplicada');
      await subirFoto(op.clave, jpeg('primer intento')).expect(200);
      const segunda = jpeg('segundo intento');
      await subirFoto(op.clave, segunda).expect(200);
      expect(await archivos(op.clave)).toEqual([`gasto-${op.clave}.jpg`]);
      expect(
        await fs.readFile(join(FOTOS_DIR_PRUEBA, `gasto-${op.clave}.jpg`)),
      ).toEqual(segunda);
    });

    it('un gasto con un campo dado de baja entra y su foto tambien', async () => {
      const op = gasto({ campo_egreso_id: campoBorradoId });
      expect((await push([op])).resultados[0].estado).toBe('aplicada');
      await subirFoto(op.clave, jpeg()).expect(200);
      expect(await archivos(op.clave)).toEqual([`gasto-${op.clave}.jpg`]);
    });

    it('la foto de un gasto rechazado es 404 y no deja archivo', async () => {
      const op = gasto({ campo_egreso_id: randomUUID() });
      expect((await push([op])).resultados[0]).toMatchObject({
        estado: 'rechazada',
        codigo: 'campo-egreso-inexistente',
      });
      await subirFoto(op.clave, jpeg()).expect(404);
      expect(await archivos(op.clave)).toEqual([]);
    });

    it('la foto del gasto de otro vendedor es 403 y no deja archivo', async () => {
      const op = gasto();
      expect((await push([op])).resultados[0].estado).toBe('aplicada');
      await subirFoto(op.clave, jpeg(), bearerAjeno).expect(403);
      expect(await archivos(op.clave)).toEqual([]);
    });

    it('algo que no es un JPEG completo es 415 y no toca el gasto', async () => {
      const op = gasto();
      expect((await push([op])).resultados[0].estado).toBe('aplicada');
      await subirFoto(op.clave, Buffer.from('no soy una foto')).expect(415);
      const fila = await db
        .selectFrom('gasto')
        .select('foto_archivo')
        .where('id', '=', op.clave)
        .executeTakeFirstOrThrow();
      expect(fila.foto_archivo).toBeNull();
    });
  });
});
