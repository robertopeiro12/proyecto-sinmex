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
  type RespuestaPush,
} from './../src/modules/sincronizacion/contrato';
import { formarFolio } from './../src/modules/sincronizacion/folio';
import { asignarSegmento } from './../src/modules/sincronizacion/segmento-vendedor';
import type { VentaDetalle } from './../src/modules/ventas-cobranza/ventas-consulta.service';

/**
 * T-73: la firma del cliente en la venta. Esta suite prueba el push (la
 * operacion `venta` con y sin `firma`); la Tarea 4 le suma la subida de la
 * imagen por el canal de fotos y la lectura del portal.
 *
 * Fecha 2015-06-15: ninguna otra suite vende ese dia y el folio es unico en
 * toda la base.
 */
const SUFIJO = `${Date.now()}-${process.pid}`;
const PASSWORD = 'contrasena-de-prueba';
const LOGIN = `e2e-firma-v-${SUFIJO}`;
const PREFIJO = `ZZ-e2e-firma-${SUFIJO}`;
const FECHA = '2015-06-15';
const LOGIN_AJENO = `e2e-firma-a-${SUFIJO}`;
const LOGIN_GENERAL = `e2e-firma-gen-${SUFIJO}`;
const LOGIN_MX = `e2e-firma-mx-${SUFIJO}`;

describe('Firma del cliente en la venta (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  let tjId: string;
  let vendedorId: string;
  let bearer: string;
  let productoId: string;
  let presentacionId: string;
  let clienteId: string;
  let segmento: string;
  let consecutivo = 0;

  const push = async (operaciones: unknown[], token = bearer) => {
    const res = await request(app.getHttpServer())
      .post('/sync/push')
      .set('Authorization', `Bearer ${token}`)
      .send({ contrato: CONTRATO_ACTUAL, operaciones })
      .expect(200);
    return res.body as RespuestaPush;
  };

  /** Una venta de la tablet, con lo que se quiera cambiar en `datos`. */
  const venta = (datos: Record<string, unknown> = {}) => ({
    clave: randomUUID(),
    tipo: 'venta',
    cliente_id: clienteId,
    fecha_operacion: FECHA,
    ocurrido_en: `${FECHA}T14:03:22.000-07:00`,
    folio: formarFolio('TJ', FECHA, segmento, ++consecutivo),
    datos: {
      num_nota: null,
      contado_credito: 'credito',
      factura: 'N/A',
      comentarios: null,
      lineas: [
        {
          presentacion_id: presentacionId,
          cantidad: 2,
          cantidad_promocion: 0,
          precio_centavos: 1500,
        },
      ],
      ...datos,
    },
  });

  const notaPorFolio = (folio: string) =>
    db
      .selectFrom('venta_nota')
      .select([
        'id',
        'firma_esperada',
        'firma_nombre',
        'firma_archivo',
        'firma_subida_en',
      ])
      .where('folio', '=', folio)
      .executeTakeFirst();

  let vendedorAjenoId: string;
  let bearerAjeno: string;
  let usuarioGeneralId: string;
  let usuarioMxId: string;
  let cookieGeneral: string;
  let cookieMx: string;

  const http = () => request(app.getHttpServer());

  const jpeg = (relleno = 'firma'): Buffer =>
    Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
      Buffer.from(relleno, 'utf8'),
      Buffer.from([0xff, 0xd9]),
    ]);

  const subirFoto = (clave: string, cuerpo: Buffer, token = bearer) =>
    http()
      .post(`/sync/foto/${clave}`)
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'image/jpeg')
      .send(cuerpo);

  const archivos = async (id: string) =>
    (await fs.readdir(FOTOS_DIR_PRUEBA)).filter((n) => n.includes(id));

  /**
   * Todas las firmas del disco. Para la venta rechazada: no hay nota, asi que
   * no hay id por el que buscar (el archivo se nombra por el id de la nota,
   * nunca por la clave); se cuenta antes y despues.
   */
  const firmasEnDisco = async () =>
    (await fs.readdir(FOTOS_DIR_PRUEBA)).filter((n) =>
      /^venta-.*-firma\.jpg$/.test(n),
    );

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
    sucursalId: string | null,
  ): Promise<string> => {
    const { id: perfilId } = await db
      .selectFrom('perfil')
      .select('id')
      .where('nombre', '=', 'Administrador General')
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
    return id;
  };

  const detalle = async (id: string, cookie = cookieGeneral) =>
    (await http().get(`/ventas/${id}`).set('Cookie', cookie).expect(200))
      .body as VentaDetalle;

  const bajarFirma = (id: string, cookie = cookieGeneral) =>
    http()
      .get(`/ventas/${id}/firma`)
      .set('Cookie', cookie)
      .buffer(true)
      .parse((res, fin) => {
        const partes: Buffer[] = [];
        res.on('data', (p: Buffer) => partes.push(p));
        res.on('end', () => fin(null, Buffer.concat(partes)));
      });

  /** Empuja una venta con firma y devuelve su clave y el id de su nota. */
  const ventaFirmada = async (nombre: string | null = 'Doña Lupe') => {
    const op = venta({ firma: { nombre } });
    expect((await push([op])).resultados[0].estado).toBe('aplicada');
    const nota = await notaPorFolio(op.folio);
    if (!nota) throw new Error('La venta no se proyecto.');
    return { clave: op.clave, ventaId: nota.id };
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication(OPCIONES_NEST);
    configurarApp(app);
    await iniciarEnLocal(app);
    db = app.get<Database>(DB_CONNECTION);

    tjId = (
      await db
        .selectFrom('sucursal')
        .select('id')
        .where('codigo', '=', 'TJ')
        .executeTakeFirstOrThrow()
    ).id;

    // Catalogo propio: la base de CI no trae productos. La venta de la tablet
    // exige algun precio para la presentacion (D12 de T-16).
    productoId = (
      await db
        .insertInto('producto')
        .values({ nombre: `${PREFIJO} Jamaica` })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    presentacionId = (
      await db
        .insertInto('presentacion')
        .values({ producto_id: productoId, volumen: '1 L' })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    const lista = await db
      .selectFrom('lista_precio')
      .select('id')
      .where('nombre', '=', 'Lista 1')
      .executeTakeFirstOrThrow();
    await db
      .insertInto('precio')
      .values({
        presentacion_id: presentacionId,
        lista_precio_id: lista.id,
        sucursal_id: tjId,
        precio: '15.00',
        vigente_desde: '2015-01-01',
      })
      .execute();
    clienteId = (
      await db
        .insertInto('cliente')
        .values({
          nombre: `${PREFIJO} Abarrotes Lupita`,
          domicilio: 'Calle 1',
          telefono: '6640000000',
          tipo: 'cliente',
          lista_precio_id: lista.id,
          sucursal_id: tjId,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;

    // El folio lleva el segmento del vendedor (T-14), que asigna el servidor.
    const ocupados = new Set(
      (
        await db
          .selectFrom('vendedor')
          .select('folio_segmento')
          .where('folio_segmento', 'is not', null)
          .where('deleted_at', 'is', null)
          .execute()
      ).map((f) => f.folio_segmento as string),
    );
    segmento = asignarSegmento('Firma Venta', ocupados) as string;
    vendedorId = (
      await db
        .insertInto('vendedor')
        .values({
          login: LOGIN,
          nombre: 'Firma Venta',
          password_hash: await app.get(PasswordService).hashear(PASSWORD),
          sucursal_id: tjId,
          folio_segmento: segmento,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;

    const login = await request(app.getHttpServer())
      .post('/auth/app/login')
      .send({ login: LOGIN, password: PASSWORD })
      .expect(200);
    bearer = (login.body as { tokenAcceso: string }).tokenAcceso;

    const mxId = (
      await db
        .selectFrom('sucursal')
        .select('id')
        .where('codigo', '=', 'MX')
        .executeTakeFirstOrThrow()
    ).id;
    vendedorAjenoId = (
      await db
        .insertInto('vendedor')
        .values({
          login: LOGIN_AJENO,
          nombre: 'Vendedor ajeno de la firma',
          password_hash: await app.get(PasswordService).hashear(PASSWORD),
          sucursal_id: tjId,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    const loginAjeno = await http()
      .post('/auth/app/login')
      .send({ login: LOGIN_AJENO, password: PASSWORD })
      .expect(200);
    bearerAjeno = (loginAjeno.body as { tokenAcceso: string }).tokenAcceso;

    usuarioGeneralId = await crearUsuario(LOGIN_GENERAL, null);
    usuarioMxId = await crearUsuario(LOGIN_MX, mxId);
    cookieGeneral = await iniciarSesion(LOGIN_GENERAL);
    cookieMx = await iniciarSesion(LOGIN_MX);
  });

  afterAll(async () => {
    // Orden inverso a las llaves foraneas.
    const notas = db
      .selectFrom('venta_nota')
      .select('id')
      .where('vendedor_id', '=', vendedorId);
    await db
      .deleteFrom('venta_nota_detalle')
      .where('venta_nota_id', 'in', notas)
      .execute();
    await db
      .deleteFrom('cobranza_abono')
      .where('venta_nota_id', 'in', notas)
      .execute();
    await db
      .deleteFrom('venta_nota')
      .where('vendedor_id', '=', vendedorId)
      .execute();
    await db
      .deleteFrom('sync_operacion')
      .where('vendedor_id', '=', vendedorId)
      .execute();
    await db.deleteFrom('cliente').where('id', '=', clienteId).execute();
    await db
      .deleteFrom('precio')
      .where('presentacion_id', '=', presentacionId)
      .execute();
    await db
      .deleteFrom('presentacion')
      .where('id', '=', presentacionId)
      .execute();
    await db.deleteFrom('producto').where('id', '=', productoId).execute();
    await db
      .deleteFrom('sesion_vendedor')
      .where('vendedor_id', 'in', [vendedorId, vendedorAjenoId])
      .execute();
    await db
      .deleteFrom('vendedor')
      .where('id', 'in', [vendedorId, vendedorAjenoId])
      .execute();
    // Despues de borrar las notas: `eliminado_por_usuario_id` apunta al usuario.
    await db
      .deleteFrom('sesion_refresh')
      .where('usuario_id', 'in', [usuarioGeneralId, usuarioMxId])
      .execute();
    await db
      .deleteFrom('usuario')
      .where('id', 'in', [usuarioGeneralId, usuarioMxId])
      .execute();
    await app.close();
    await fs.rm(FOTOS_DIR_PRUEBA, { recursive: true, force: true });
  });

  describe('push (contrato)', () => {
    it('una venta con firma la espera y guarda el nombre recortado', async () => {
      const op = venta({ firma: { nombre: '  Doña Lupe  ' } });
      expect((await push([op])).resultados[0].estado).toBe('aplicada');
      expect(await notaPorFolio(op.folio)).toMatchObject({
        firma_esperada: true,
        firma_nombre: 'Doña Lupe',
        firma_archivo: null,
        firma_subida_en: null,
      });
    });

    it('una firma sin nombre la espera igual', async () => {
      const op = venta({ firma: { nombre: null } });
      expect((await push([op])).resultados[0].estado).toBe('aplicada');
      expect(await notaPorFolio(op.folio)).toMatchObject({
        firma_esperada: true,
        firma_nombre: null,
      });
    });

    it('una venta sin firma (app anterior a T-73) entra y no la espera', async () => {
      const op = venta();
      expect((await push([op])).resultados[0].estado).toBe('aplicada');
      expect(await notaPorFolio(op.folio)).toMatchObject({
        firma_esperada: false,
        firma_nombre: null,
      });
    });

    it('un nombre de mas de 80 caracteres rechaza la venta entera y no deja fila', async () => {
      const op = venta({ firma: { nombre: 'x'.repeat(81) } });
      const [r] = (await push([op])).resultados;
      expect(r).toMatchObject({
        estado: 'rechazada',
        codigo: 'datos-invalidos',
      });
      expect(r.motivo).toMatch(/^firma\.nombre/);
      expect(await notaPorFolio(op.folio)).toBeUndefined();
      const buzon = await db
        .selectFrom('sync_operacion')
        .select('id')
        .where('clave_idempotencia', '=', op.clave)
        .execute();
      expect(buzon).toEqual([]);
    });
  });

  describe('imagen por el canal de fotos', () => {
    it('la firma de una venta aplicada se guarda como venta-<id>-firma.jpg y se anota en la nota', async () => {
      const { clave, ventaId } = await ventaFirmada();
      const bytes = jpeg('firma de Lupe');

      const res = await subirFoto(clave, bytes).expect(200);
      expect(res.body).toMatchObject({ clave });
      expect(await archivos(ventaId)).toEqual([`venta-${ventaId}-firma.jpg`]);
      expect(
        await fs.readFile(join(FOTOS_DIR_PRUEBA, `venta-${ventaId}-firma.jpg`)),
      ).toEqual(bytes);
      const nota = await db
        .selectFrom('venta_nota')
        .select(['firma_archivo', 'firma_subida_en'])
        .where('id', '=', ventaId)
        .executeTakeFirstOrThrow();
      expect(nota.firma_archivo).toBe(`venta-${ventaId}-firma.jpg`);
      expect(nota.firma_subida_en).not.toBeNull();
    });

    it('reenviar la firma deja un solo archivo, con lo ultimo que llego', async () => {
      const { clave, ventaId } = await ventaFirmada();
      await subirFoto(clave, jpeg('primer intento')).expect(200);
      const segunda = jpeg('segundo intento');
      await subirFoto(clave, segunda).expect(200);
      expect(await archivos(ventaId)).toEqual([`venta-${ventaId}-firma.jpg`]);
      expect(
        await fs.readFile(join(FOTOS_DIR_PRUEBA, `venta-${ventaId}-firma.jpg`)),
      ).toEqual(segunda);
    });

    it('una venta sin firma (app anterior a T-73) responde 409 y no deja archivo', async () => {
      const op = venta();
      expect((await push([op])).resultados[0].estado).toBe('aplicada');
      const nota = await notaPorFolio(op.folio);
      const res = await subirFoto(op.clave, jpeg()).expect(409);
      expect((res.body as { message: string }).message).toBe(
        'Esa venta no espera firma.',
      );
      expect(await archivos(nota?.id ?? 'sin-nota')).toEqual([]);
    });

    it('la firma de una venta rechazada es 404 y nunca deja archivo (Review Focus 4)', async () => {
      const op = venta({ firma: { nombre: 'x'.repeat(81) } });
      expect((await push([op])).resultados[0].estado).toBe('rechazada');
      const antes = await firmasEnDisco();
      await subirFoto(op.clave, jpeg()).expect(404);
      expect(await firmasEnDisco()).toEqual(antes);
    });

    it('la firma de una venta eliminada en el portal es 404 y no deja archivo (Review Focus 5)', async () => {
      const { clave, ventaId } = await ventaFirmada();
      await http()
        .delete(`/ventas/${ventaId}`)
        .set('Cookie', cookieGeneral)
        .expect(200);
      await subirFoto(clave, jpeg()).expect(404);
      expect(await archivos(ventaId)).toEqual([]);
    });

    it('la firma de la venta de otro vendedor es 403 y no deja archivo', async () => {
      const { clave, ventaId } = await ventaFirmada();
      await subirFoto(clave, jpeg(), bearerAjeno).expect(403);
      expect(await archivos(ventaId)).toEqual([]);
    });
  });

  describe('portal: detalle y GET /ventas/:id/firma', () => {
    it('el detalle trae la firma subida y GET /firma la sirve como JPEG privado sin cache', async () => {
      const { clave, ventaId } = await ventaFirmada();
      const bytes = jpeg('firma para el portal');
      await subirFoto(clave, bytes).expect(200);

      const d = await detalle(ventaId);
      expect(d.firma).toEqual({
        esperada: true,
        nombre: 'Doña Lupe',
        subidaEn: expect.any(String) as string,
      });
      expect(d.editada).toBe(false);

      const res = await bajarFirma(ventaId).expect(200);
      expect(res.headers['content-type']).toMatch(/^image\/jpeg/);
      expect(res.headers['cache-control']).toBe('private, no-store');
      expect(res.body).toEqual(bytes);
    });

    it('una firma pendiente de subir: esperada sin subidaEn, y GET /firma es 404', async () => {
      const { ventaId } = await ventaFirmada(null);
      expect((await detalle(ventaId)).firma).toEqual({
        esperada: true,
        nombre: null,
        subidaEn: null,
      });
      await bajarFirma(ventaId).expect(404);
    });

    it('una venta sin firma no la espera', async () => {
      const op = venta();
      expect((await push([op])).resultados[0].estado).toBe('aplicada');
      const nota = await notaPorFolio(op.folio);
      expect((await detalle(nota?.id ?? '')).firma).toEqual({
        esperada: false,
        nombre: null,
        subidaEn: null,
      });
    });

    it('editada es true cuando el portal toco la nota', async () => {
      const { ventaId } = await ventaFirmada();
      await db
        .updateTable('venta_nota')
        .set({ actualizado_por_usuario_id: usuarioGeneralId })
        .where('id', '=', ventaId)
        .execute();
      expect((await detalle(ventaId)).editada).toBe(true);
    });

    it('otra sucursal: GET /firma es 403, igual que el detalle', async () => {
      const { clave, ventaId } = await ventaFirmada();
      await subirFoto(clave, jpeg()).expect(200);
      await http()
        .get(`/ventas/${ventaId}`)
        .set('Cookie', cookieMx)
        .expect(403);
      await bajarFirma(ventaId, cookieMx).expect(403);
    });
  });
});
