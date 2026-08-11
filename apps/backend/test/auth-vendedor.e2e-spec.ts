import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { OPCIONES_NEST, configurarApp } from './../src/configurar-app';
import {
  DB_CONNECTION,
  type Database,
} from './../src/database/database.tokens';
import { PasswordService } from './../src/modules/auth/password.service';

interface RespuestaError {
  message: string;
}

interface RespuestaAuthApp {
  vendedor: {
    id: string;
    login: string;
    nombre: string;
    sucursal: { id: string; codigo: string; nombre: string };
  };
  tokenAcceso: string;
  accesoExpiraEn: string;
  tokenRefresh: string;
  sesionExpiraEn: string;
  politica: { ventanaOfflineHoras: number; costeVerificador: number };
}

const LOGIN = `e2e-vendedor-${Date.now()}`;
const PASSWORD = 'contrasena-del-vendedor';

/** Login de un usuario del PORTAL, para las pruebas de cruce entre actores. */
const LOGIN_PORTAL = `e2e-portal-cruce-${Date.now()}`;

describe('Auth de la app del vendedor (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  let vendedorId: string;
  let usuarioPortalId: string;

  const leerCookie = (
    headers: string[] | undefined,
    nombre: string,
  ): string | undefined =>
    headers
      ?.find((c) => c.startsWith(`${nombre}=`))
      ?.split(';')[0]
      ?.split('=')[1];

  const entrar = async (): Promise<RespuestaAuthApp> => {
    const res = await request(app.getHttpServer())
      .post('/auth/app/login')
      .send({ login: LOGIN, password: PASSWORD })
      .expect(200);
    return res.body as RespuestaAuthApp;
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication(OPCIONES_NEST);
    configurarApp(app);
    await app.init();

    db = app.get<Database>(DB_CONNECTION);

    const sucursal = await db
      .selectFrom('sucursal')
      .select('id')
      .where('deleted_at', 'is', null)
      .orderBy('codigo')
      .executeTakeFirstOrThrow();

    const passwordHash = await new PasswordService().hashear(PASSWORD);

    const vendedor = await db
      .insertInto('vendedor')
      .values({
        login: LOGIN,
        nombre: 'Vendedor e2e',
        password_hash: passwordHash,
        sucursal_id: sucursal.id,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    vendedorId = vendedor.id;

    const perfil = await db
      .selectFrom('perfil')
      .select('id')
      .orderBy('nombre')
      .executeTakeFirstOrThrow();

    const usuario = await db
      .insertInto('usuario')
      .values({
        login: LOGIN_PORTAL,
        nombre: 'Usuario e2e de cruce',
        password_hash: passwordHash,
        perfil_id: perfil.id,
        sucursal_id: null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    usuarioPortalId = usuario.id;
  });

  afterAll(async () => {
    await db
      .deleteFrom('sesion_vendedor')
      .where('vendedor_id', '=', vendedorId)
      .execute();
    await db.deleteFrom('vendedor').where('id', '=', vendedorId).execute();
    await db
      .deleteFrom('sesion_refresh')
      .where('usuario_id', '=', usuarioPortalId)
      .execute();
    await db.deleteFrom('usuario').where('id', '=', usuarioPortalId).execute();
    await app.close();
  });

  describe('login', () => {
    it('devuelve tokens, el vendedor con su sucursal y la politica offline', async () => {
      const cuerpo = await entrar();

      expect(cuerpo.vendedor).toMatchObject({ id: vendedorId, login: LOGIN });
      expect(cuerpo.vendedor.sucursal.codigo).toMatch(/^[A-Z]{2}$/);
      expect(cuerpo.tokenAcceso).toBeTruthy();
      expect(cuerpo.tokenRefresh).toBeTruthy();

      // La app necesita las dos fechas para decidir sin red; si el servidor
      // dejara de mandarlas, la sesion offline no tendria contra que medirse.
      expect(Number.isFinite(Date.parse(cuerpo.accesoExpiraEn))).toBe(true);
      expect(Number.isFinite(Date.parse(cuerpo.sesionExpiraEn))).toBe(true);

      // Y la politica, que es lo que la tablet obedece en vez de cablearla.
      expect(cuerpo.politica.ventanaOfflineHoras).toBeGreaterThan(0);
      expect(cuerpo.politica.costeVerificador).toBeGreaterThanOrEqual(10_000);
    });

    it('NO devuelve cookies: la app guarda sus tokens ella misma', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/app/login')
        .send({ login: LOGIN, password: PASSWORD })
        .expect(200);

      // Si alguien "unificara" este login con el del portal reusando
      // ponerCookies(), esto lo detendria: una app nativa no tiene contexto de
      // dominio y la cookie quedaria fuera del almacenamiento cifrado.
      expect(res.headers['set-cookie']).toBeUndefined();
    });

    it('NO devuelve el hash de la contrasena ni nada derivado de ella', async () => {
      // El verificador offline lo deriva la app con la contrasena que ya tiene.
      // Mandar el hash del servidor lo pondria en la red y en el dispositivo
      // sin ganar nada. Ver ADR-0005.
      const res = await request(app.getHttpServer())
        .post('/auth/app/login')
        .send({ login: LOGIN, password: PASSWORD })
        .expect(200);

      expect(JSON.stringify(res.body)).not.toContain('argon2');
      expect(JSON.stringify(res.body)).not.toContain('password');
    });

    it('rechaza la contrasena incorrecta con un 401 generico', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/app/login')
        .send({ login: LOGIN, password: 'incorrecta' })
        .expect(401);
      expect((res.body as RespuestaError).message).toBe(
        'Credenciales invalidas.',
      );
    });

    it('un login inexistente da EXACTAMENTE el mismo 401', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/app/login')
        .send({ login: 'no-existe-este-vendedor', password: 'lo-que-sea' })
        .expect(401);
      expect((res.body as RespuestaError).message).toBe(
        'Credenciales invalidas.',
      );
    });

    it('un vendedor DESACTIVADO no entra, y vuelve a entrar al reactivarlo', async () => {
      // `activo` es el interruptor que de verdad se usa en este negocio: los
      // vendedores son rotativos y se desactivan, no se borran (ver
      // [[Vendedor]]). Comprobar solo `deleted_at` dejaria pasar el caso comun.
      await db
        .updateTable('vendedor')
        .set({ activo: false })
        .where('id', '=', vendedorId)
        .execute();

      try {
        const res = await request(app.getHttpServer())
          .post('/auth/app/login')
          .send({ login: LOGIN, password: PASSWORD })
          .expect(401);
        expect((res.body as RespuestaError).message).toBe(
          'Credenciales invalidas.',
        );
      } finally {
        await db
          .updateTable('vendedor')
          .set({ activo: true })
          .where('id', '=', vendedorId)
          .execute();
      }

      await entrar();
    });

    it('un vendedor dado de baja (deleted_at) no entra', async () => {
      await db
        .updateTable('vendedor')
        .set({ deleted_at: new Date() })
        .where('id', '=', vendedorId)
        .execute();

      try {
        await request(app.getHttpServer())
          .post('/auth/app/login')
          .send({ login: LOGIN, password: PASSWORD })
          .expect(401);
      } finally {
        await db
          .updateTable('vendedor')
          .set({ deleted_at: null })
          .where('id', '=', vendedorId)
          .execute();
      }

      await entrar();
    });

    it('un body sin contrasena da 400 de validacion', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/app/login')
        .send({ login: LOGIN })
        .expect(400);
      expect((res.body as { message: string[] }).message).toContain(
        'La contrasena es obligatoria.',
      );
    });
  });

  describe('separacion entre el actor del portal y el de la app', () => {
    it('/auth/app/me exige Bearer: sin encabezado, 401 del guard', async () => {
      const res = await request(app.getHttpServer())
        .get('/auth/app/me')
        .expect(401);
      expect((res.body as RespuestaError).message).toBe('Sin sesion.');
    });

    it('/auth/app/me acepta el Bearer del vendedor', async () => {
      const { tokenAcceso } = await entrar();
      const res = await request(app.getHttpServer())
        .get('/auth/app/me')
        .set('Authorization', `Bearer ${tokenAcceso}`)
        .expect(200);

      expect(res.body).toMatchObject({ id: vendedorId, login: LOGIN });
      expect(res.body).not.toHaveProperty('password_hash');
    });

    it('el token de la APP no sirve en un endpoint del PORTAL', async () => {
      const { tokenAcceso } = await entrar();

      // Ni como cookie (el portal solo mira la cookie)...
      const comoCookie = await request(app.getHttpServer())
        .get('/auth/me')
        .set('Cookie', [`jawa_access=${tokenAcceso}`])
        .expect(401);
      // ...y el mensaje confirma que lo rechazo la validacion del tipo de
      // token, no la ausencia de cookie: son dos fallos distintos.
      expect((comoCookie.body as RespuestaError).message).toBe(
        'Sesion invalida o vencida.',
      );

      // ...ni como Bearer (el portal ni lo lee).
      const comoBearer = await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${tokenAcceso}`)
        .expect(401);
      expect((comoBearer.body as RespuestaError).message).toBe('Sin sesion.');
    });

    it('el token del PORTAL no sirve en un endpoint de la APP', async () => {
      const login = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ login: LOGIN_PORTAL, password: PASSWORD })
        .expect(200);

      const acceso = leerCookie(
        login.headers['set-cookie'] as unknown as string[],
        'jawa_access',
      );
      expect(acceso).toBeDefined();

      // Como Bearer: lo lee, pero el claim `tipo` es 'usuario'.
      const comoBearer = await request(app.getHttpServer())
        .get('/auth/app/me')
        .set('Authorization', `Bearer ${acceso}`)
        .expect(401);
      expect((comoBearer.body as RespuestaError).message).toBe(
        'Sesion invalida o vencida.',
      );

      // Como cookie: la app ni la mira.
      const comoCookie = await request(app.getHttpServer())
        .get('/auth/app/me')
        .set('Cookie', [`jawa_access=${acceso}`])
        .expect(401);
      expect((comoCookie.body as RespuestaError).message).toBe('Sin sesion.');
    });

    it('el refresh de la app no vale como refresh del portal', async () => {
      const { tokenRefresh } = await entrar();
      await request(app.getHttpServer())
        .post('/auth/refresh')
        .set('Cookie', [`jawa_refresh=${tokenRefresh}`])
        .expect(401);
    });
  });

  describe('rotacion de la sesion', () => {
    it('refresh rota el token y corre la ventana offline hacia adelante', async () => {
      const inicial = await entrar();

      const res = await request(app.getHttpServer())
        .post('/auth/app/refresh')
        .send({ tokenRefresh: inicial.tokenRefresh })
        .expect(200);
      const rotado = res.body as RespuestaAuthApp;

      expect(rotado.tokenRefresh).not.toBe(inicial.tokenRefresh);
      expect(rotado.vendedor.id).toBe(vendedorId);
      // La sesion nueva vence despues que la vieja: es lo que hace que
      // sincronizar prolongue la autonomia de la tablet.
      expect(Date.parse(rotado.sesionExpiraEn)).toBeGreaterThanOrEqual(
        Date.parse(inicial.sesionExpiraEn),
      );
    });

    it('reusar un refresh ya rotado revoca TODA la cadena del vendedor', async () => {
      const inicial = await entrar();
      const res = await request(app.getHttpServer())
        .post('/auth/app/refresh')
        .send({ tokenRefresh: inicial.tokenRefresh })
        .expect(200);
      const rotado = res.body as RespuestaAuthApp;

      const reuso = await request(app.getHttpServer())
        .post('/auth/app/refresh')
        .send({ tokenRefresh: inicial.tokenRefresh })
        .expect(401);
      expect((reuso.body as RespuestaError).message).toBe('Sesion invalida.');

      // Y la sesion "legitima" tambien cae: es el castigo al reuso.
      await request(app.getHttpServer())
        .post('/auth/app/refresh')
        .send({ tokenRefresh: rotado.tokenRefresh })
        .expect(401);
    });

    it('desactivar al vendedor corta una sesion YA ABIERTA: su refresh deja de rotar', async () => {
      // Es la invariante que hace posible revocar a distancia. Sin ella, una
      // tablet con sesion abierta seguiria renovandose para siempre y la baja
      // hecha en el portal no llegaria nunca al dispositivo.
      const sesion = await entrar();

      await db
        .updateTable('vendedor')
        .set({ activo: false })
        .where('id', '=', vendedorId)
        .execute();

      try {
        const res = await request(app.getHttpServer())
          .post('/auth/app/refresh')
          .send({ tokenRefresh: sesion.tokenRefresh })
          .expect(401);
        expect((res.body as RespuestaError).message).toBe('Sesion invalida.');
      } finally {
        await db
          .updateTable('vendedor')
          .set({ activo: true })
          .where('id', '=', vendedorId)
          .execute();
      }

      // Reactivado, el MISMO refresh vuelve a rotar: confirma que el 401 lo
      // causo la baja y no un token ya quemado, y que desactivar no revoca la
      // cadena (misma asimetria deliberada que en el portal).
      await request(app.getHttpServer())
        .post('/auth/app/refresh')
        .send({ tokenRefresh: sesion.tokenRefresh })
        .expect(200);
    });

    it('dar de baja al vendedor (deleted_at) tambien corta la rotacion', async () => {
      const sesion = await entrar();

      await db
        .updateTable('vendedor')
        .set({ deleted_at: new Date() })
        .where('id', '=', vendedorId)
        .execute();

      try {
        await request(app.getHttpServer())
          .post('/auth/app/refresh')
          .send({ tokenRefresh: sesion.tokenRefresh })
          .expect(401);
      } finally {
        await db
          .updateTable('vendedor')
          .set({ deleted_at: null })
          .where('id', '=', vendedorId)
          .execute();
      }

      await request(app.getHttpServer())
        .post('/auth/app/refresh')
        .send({ tokenRefresh: sesion.tokenRefresh })
        .expect(200);
    });

    it('un refresh vencido no rota', async () => {
      const sesion = await entrar();
      await db
        .updateTable('sesion_vendedor')
        .set({ expira_en: new Date(Date.now() - 1000) })
        .where('vendedor_id', '=', vendedorId)
        .where('revocada_en', 'is', null)
        .execute();

      await request(app.getHttpServer())
        .post('/auth/app/refresh')
        .send({ tokenRefresh: sesion.tokenRefresh })
        .expect(401);
    });

    it('un refresh inventado no rota', async () => {
      await request(app.getHttpServer())
        .post('/auth/app/refresh')
        .send({ tokenRefresh: 'esto-no-existe' })
        .expect(401);
    });

    it('dos rotaciones concurrentes del mismo refresh: solo una gana y no queda ninguna sesion viva', async () => {
      // Es la invariante mas sutil del sistema y la razon de que
      // `revocarSiViva` sea un UPDATE condicional: sin ese punto de
      // serializacion, dos usos paralelos del mismo token —que es
      // exactamente la firma de un token robado— podrian salir los dos
      // adelante y la deteccion de reuso quedaria ciega.
      //
      // Una tablet lo produce sola: la app reintenta al recuperar la WiFi
      // justo cuando la sincronizacion de T-07 tambien renueva.
      const sesion = await entrar();

      // Se disparan a la vez, sin esperar una antes de la otra.
      const resultados = await Promise.all([
        request(app.getHttpServer())
          .post('/auth/app/refresh')
          .send({ tokenRefresh: sesion.tokenRefresh }),
        request(app.getHttpServer())
          .post('/auth/app/refresh')
          .send({ tokenRefresh: sesion.tokenRefresh }),
      ]);

      const estados = resultados.map((r) => r.status).sort();
      expect(estados).toEqual([200, 401]);

      // Y la sesion de la llamada GANADORA tambien queda revocada: el reuso
      // concurrente corta toda la cadena, incluida la rama "legitima". Sin
      // esta asercion, la prueba pasaria igual con una implementacion que
      // solo rechazara a la perdedora.
      const vivas = await db
        .selectFrom('sesion_vendedor')
        .select('id')
        .where('vendedor_id', '=', vendedorId)
        .where('revocada_en', 'is', null)
        .execute();
      expect(vivas).toHaveLength(0);
    });
  });

  describe('logout', () => {
    it('revoca la sesion y el refresh usado deja de servir', async () => {
      const sesion = await entrar();

      await request(app.getHttpServer())
        .post('/auth/app/logout')
        .send({ tokenRefresh: sesion.tokenRefresh })
        .expect(200);

      await request(app.getHttpServer())
        .post('/auth/app/refresh')
        .send({ tokenRefresh: sesion.tokenRefresh })
        .expect(401);
    });

    it('es publico a proposito: se puede cerrar sesion con el access token ya vencido', async () => {
      // El access dura 12 h y la sesion 7 dias; exigir un access vivo dejaria
      // el boton de salir inservible justo cuando hace falta. Mismo criterio
      // que el logout del portal.
      const sesion = await entrar();
      await request(app.getHttpServer())
        .post('/auth/app/logout')
        .send({ tokenRefresh: sesion.tokenRefresh })
        .expect(200);
    });

    it('cerrar sesion dos veces no revoca de mas', async () => {
      const sesion = await entrar();
      await request(app.getHttpServer())
        .post('/auth/app/logout')
        .send({ tokenRefresh: sesion.tokenRefresh })
        .expect(200);
      await request(app.getHttpServer())
        .post('/auth/app/logout')
        .send({ tokenRefresh: sesion.tokenRefresh })
        .expect(200);
    });
  });

  describe('el token de la app guarda su sesion, no la contrasena', () => {
    it('la fila de sesion guarda el token HASHEADO, nunca el plano', async () => {
      const sesion = await entrar();
      const filas = await db
        .selectFrom('sesion_vendedor')
        .select('token_hash')
        .where('vendedor_id', '=', vendedorId)
        .execute();

      expect(filas.some((f) => f.token_hash === sesion.tokenRefresh)).toBe(
        false,
      );
      expect(filas.length).toBeGreaterThan(0);
    });

    it('la sesion que guardara la tablet cabe holgadamente en expo-secure-store', async () => {
      // Android limita el tamano de cada valor de SecureStore (~2 KB): pasarse
      // no daria un error de compilacion, daria un fallo al guardar la sesion
      // EN EL DISPOSITIVO, que es justo lo que aqui no se puede probar. Esta
      // asercion es el guardarrail: si alguien engorda la respuesta del login
      // (mas datos del vendedor, un catalogo, permisos de T-08), salta aqui.
      const sesion = await entrar();
      const guardado = JSON.stringify({
        ...sesion,
        // Lo unico que la tablet agrega y el servidor no manda.
        verificador: `pbkdf2-sha256$60000$${'a'.repeat(32)}$${'b'.repeat(64)}`,
        ultimoContactoServidor: new Date().toISOString(),
        intentosFallidos: 0,
      });

      // Medido: 858 bytes. El limite de 1500 deja margen sin dejar de avisar
      // mucho antes de los ~2 KB de Android.
      expect(Buffer.byteLength(guardado, 'utf8')).toBeLessThan(1500);
    });
  });
});
