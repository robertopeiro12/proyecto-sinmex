import { Test, type TestingModule } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { verify } from '@node-rs/argon2';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { DatabaseModule } from './../src/database/database.module';
import {
  DB_CONNECTION,
  type Database,
} from './../src/database/database.tokens';
import { AuthModule } from './../src/modules/auth/auth.module';
import { HASH_SENUELO } from './../src/modules/auth/auth.service';
import { PasswordService } from './../src/modules/auth/password.service';

interface RespuestaError {
  message: string;
}

const LOGIN = `e2e-auth-${Date.now()}`;
const PASSWORD = 'contrasena-de-prueba';

describe('Auth (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  let usuarioId: string;

  /** Extrae el valor de una cookie del header set-cookie. */
  const leerCookie = (
    headers: string[] | undefined,
    nombre: string,
  ): string | undefined =>
    headers
      ?.find((c) => c.startsWith(`${nombre}=`))
      ?.split(';')[0]
      ?.split('=')[1];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    // main.ts registra esto en bootstrap(); createNestApplication() no pasa
    // por ahi, asi que se repite a mano (igual que en app.e2e-spec.ts). Sin
    // cookieParser(), req.cookies queda undefined y todo pasaria por la rama
    // de "sin cookie"; sin el ValidationPipe, el DTO de login no filtraria
    // el caso de body sin password.
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();

    db = app.get<Database>(DB_CONNECTION);

    const perfil = await db
      .selectFrom('perfil')
      .select('id')
      .orderBy('nombre')
      .executeTakeFirstOrThrow();

    const usuario = await db
      .insertInto('usuario')
      .values({
        login: LOGIN,
        nombre: 'Usuario e2e',
        password_hash: await new PasswordService().hashear(PASSWORD),
        perfil_id: perfil.id,
        sucursal_id: null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    usuarioId = usuario.id;
  });

  afterAll(async () => {
    await db
      .deleteFrom('sesion_refresh')
      .where('usuario_id', '=', usuarioId)
      .execute();
    await db.deleteFrom('usuario').where('id', '=', usuarioId).execute();
    await app.close();
  });

  it('rechaza credenciales invalidas con el 401 del servicio, no del guard', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ login: LOGIN, password: 'incorrecta' })
      .expect(401);

    // /auth/login es publico: si este 401 viniera del guard global (p.ej.
    // porque alguien le quito @Publico() al endpoint) el mensaje seria "Sin
    // sesion." o "Sesion invalida o vencida.", no este. Afirmar solo el
    // status dejaria pasar ese cambio como si nada.
    expect((res.body as RespuestaError).message).toBe(
      'Credenciales invalidas.',
    );
  });

  it('rechaza un login inexistente con exactamente el mismo 401 que una contrasena incorrecta', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ login: 'nadie-tiene-este-login', password: 'lo-que-sea' })
      .expect(401);

    // Mismo mensaje que el caso anterior: si el servicio empezara a
    // distinguir "no existe" de "contrasena incorrecta" (por ejemplo, con
    // un mensaje distinto o un codigo de error propio), este assert lo
    // atraparia aunque el status siguiera siendo 401 en ambos casos.
    expect((res.body as RespuestaError).message).toBe(
      'Credenciales invalidas.',
    );
  });

  it('rechaza un body sin password con 400 de validacion', async () => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ login: LOGIN })
      .expect(400);
  });

  it('/auth/me sin sesion devuelve 401 con el mensaje del guard', async () => {
    const res = await request(app.getHttpServer()).get('/auth/me').expect(401);

    // Distingue el guard global (protege TODO por defecto) del decorador
    // @UsuarioActual (que tambien lanza 401 pero con "Sesion invalida.").
    // Si se borrara el guard de app.module.ts, esta prueba seguiria en
    // verde con solo expect(401) porque el decorador rescataria el caso;
    // el mensaje es lo que realmente prueba que el guard sigue ahi.
    expect((res.body as RespuestaError).message).toBe('Sin sesion.');
  });

  it('flujo: login -> me -> refresh rota -> reusar el refresh viejo revoca toda la cadena', async () => {
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ login: LOGIN, password: PASSWORD })
      .expect(200);

    const cookies = login.headers['set-cookie'] as unknown as string[];
    const acceso = leerCookie(cookies, 'jawa_access');
    const refresh = leerCookie(cookies, 'jawa_refresh');
    expect(acceso).toBeDefined();
    expect(refresh).toBeDefined();

    // Las cookies deben ser httpOnly.
    expect(cookies.every((c) => c.includes('HttpOnly'))).toBe(true);

    const me = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Cookie', [`jawa_access=${acceso}`])
      .expect(200);

    expect(me.body).toMatchObject({
      login: LOGIN,
      nombre: 'Usuario e2e',
      sucursal: null,
    });
    expect(me.body).not.toHaveProperty('password_hash');

    const refrescado = await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', [`jawa_refresh=${refresh}`])
      .expect(200);

    const nuevoRefresh = leerCookie(
      refrescado.headers['set-cookie'] as unknown as string[],
      'jawa_refresh',
    );
    expect(nuevoRefresh).toBeDefined();
    expect(nuevoRefresh).not.toBe(refresh);

    // Reusar el refresh viejo es 401 y tumba la sesion nueva tambien. Se
    // afirma el mensaje ("Sesion invalida.") porque /auth/refresh es
    // publico: sin el mensaje, un 401 generico tambien lo produciria, por
    // ejemplo, un cambio que hiciera el endpoint requerir el guard.
    const reuso1 = await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', [`jawa_refresh=${refresh}`])
      .expect(401);
    expect((reuso1.body as RespuestaError).message).toBe('Sesion invalida.');

    const reuso2 = await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', [`jawa_refresh=${nuevoRefresh}`])
      .expect(401);
    expect((reuso2.body as RespuestaError).message).toBe('Sesion invalida.');
  });

  it('logout revoca la sesion de refresh, limpia las cookies y el refresh usado deja de servir', async () => {
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ login: LOGIN, password: PASSWORD })
      .expect(200);

    const refresh = leerCookie(
      login.headers['set-cookie'] as unknown as string[],
      'jawa_refresh',
    );
    expect(refresh).toBeDefined();

    const salida = await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Cookie', [`jawa_refresh=${refresh}`])
      .expect(200);

    const cookiesSalida = salida.headers['set-cookie'] as unknown as string[];
    // limpiarCookies() usa res.clearCookie(), que fija Expires en el pasado
    // (Express lo hace con new Date(1)). Si logout dejara de limpiar las
    // cookies, esta corrida no encontraria ninguna cookie con Expires en
    // 1970 y fallaria, aunque el status siguiera siendo 200.
    expect(
      cookiesSalida.some(
        (c) => c.startsWith('jawa_access=;') && c.includes('1970'),
      ),
    ).toBe(true);
    expect(
      cookiesSalida.some(
        (c) => c.startsWith('jawa_refresh=;') && c.includes('1970'),
      ),
    ).toBe(true);

    // El refresh que se acaba de cerrar ya no debe servir para refrescar.
    const res = await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', [`jawa_refresh=${refresh}`])
      .expect(401);
    expect((res.body as RespuestaError).message).toBe('Sesion invalida.');
  });

  it('un usuario dado de baja (deleted_at) no puede entrar, y puede otra vez tras restaurarlo', async () => {
    await db
      .updateTable('usuario')
      .set({ deleted_at: new Date() })
      .where('id', '=', usuarioId)
      .execute();

    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ login: LOGIN, password: PASSWORD })
      .expect(401);
    expect((res.body as RespuestaError).message).toBe(
      'Credenciales invalidas.',
    );

    await db
      .updateTable('usuario')
      .set({ deleted_at: null })
      .where('id', '=', usuarioId)
      .execute();

    // No basta con confirmar que corrio el UPDATE: se confirma la reversion
    // real dejando que el usuario vuelva a poder loguearse. Si el UPDATE de
    // arriba fallara silenciosamente (o el filtro `deleted_at is null` de
    // AuthService quedara mal escrito), este login seguiria dando 401.
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ login: LOGIN, password: PASSWORD })
      .expect(200);
  });

  it('el hash senuelo sigue siendo un argon2id que de verdad parsea (no pierde la ecualizacion de tiempos en silencio)', async () => {
    // Un hash con formato invalido hace que argon2 LANCE internamente. Esto
    // confirma que el "resolves.toBe(false)" de abajo para HASH_SENUELO no
    // esta pasando por la misma razon que este caso corrupto: si asi fuera
    // (es decir, si HASH_SENUELO dejara de parsear), la llamada de abajo
    // rechazaria en vez de resolver, y el test lo detectaria.
    await expect(verify('esto-no-es-un-hash-argon2', 'x')).rejects.toThrow();

    // HASH_SENUELO debe seguir siendo un hash argon2id valido: verify() debe
    // RESOLVER (no lanzar) con resultado false, porque ninguna contrasena
    // coincide con un hash senuelo generado al azar.
    await expect(verify(HASH_SENUELO, 'lo-que-sea')).resolves.toBe(false);

    // Y la ruta real que usa AuthService (PasswordService.verificar, que
    // atrapa cualquier excepcion) debe devolver false sin lanzar. Si
    // HASH_SENUELO dejara de parsear, esta linea seguiria en verde sola
    // (el catch la salva) — por eso las dos comprobaciones de arriba son
    // las que realmente detectan la perdida silenciosa de la ecualizacion.
    await expect(
      new PasswordService().verificar(HASH_SENUELO, 'lo-que-sea'),
    ).resolves.toBe(false);
  });
});

describe('Arranque del backend con JWT_SECRET vacio (e2e)', () => {
  it('rechaza compilar el modulo de auth en vez de arrancar sin secreto', async () => {
    const original = process.env.JWT_SECRET;
    process.env.JWT_SECRET = '';
    try {
      // Se reproduce el mismo arbol de modulos que usa AuthModule en
      // produccion (ConfigModule + DatabaseModule reales) para que el unico
      // motivo de rechazo posible sea el factory de JwtModule.registerAsync
      // en auth.module.ts. Si ese factory dejara de validar JWT_SECRET (o
      // arrancara con un secreto vacio/undefined), compile() resolveria en
      // vez de rechazar y este test fallaria.
      await expect(
        Test.createTestingModule({
          imports: [
            ConfigModule.forRoot({
              isGlobal: true,
              envFilePath: ['../../.env.test', '../../.env'],
            }),
            DatabaseModule,
            AuthModule,
          ],
        }).compile(),
      ).rejects.toThrow('Falta JWT_SECRET.');
    } finally {
      // Restaurar sin importar el resultado: otros archivos e2e del mismo
      // proceso de Jest comparten process.env.
      process.env.JWT_SECRET = original;
    }
  });
});
