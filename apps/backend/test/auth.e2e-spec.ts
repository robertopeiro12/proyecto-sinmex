import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { verify } from '@node-rs/argon2';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { OPCIONES_NEST, configurarApp } from './../src/configurar-app';
import { DatabaseModule } from './../src/database/database.module';
import {
  DB_CONNECTION,
  type Database,
} from './../src/database/database.tokens';
import { AuthModule } from './../src/modules/auth/auth.module';
import { HASH_SENUELO } from './../src/modules/auth/auth.constantes';
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

    // Se construye con LA MISMA configuracion que main.ts (OPCIONES_NEST +
    // configurarApp), no con una copia a mano: si divergieran, esta suite
    // estaria probando una app que no existe en produccion. En particular
    // OPCIONES_NEST tiene que ir aqui, en la creacion, porque `bodyParser` no
    // es middleware y no puede aplicarse despues — de eso depende el test de
    // CSRF de login.
    app = moduleFixture.createNestApplication(OPCIONES_NEST);
    configurarApp(app);
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
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ login: LOGIN })
      .expect(400);

    // Sin el ValidationPipe, `password` llegaria como undefined al servicio
    // (un 401 generico, no un 400) o el placeholder de argon2 lanzaria un
    // 500. El mensaje del DTO (LoginDto) es lo que confirma que este 400 lo
    // produjo class-validator sobre el campo `password`, y no otra cosa que
    // tambien devolviera 400 por casualidad.
    const mensajes = (res.body as { message: string[] }).message;
    expect(mensajes).toContain('La contrasena es obligatoria.');
  });

  it('no autentica un login enviado como formulario (CSRF de login): sin parser urlencoded no hay Set-Cookie', async () => {
    // El ataque: una pagina cualquiera autoenvia un <form method="POST"> a
    // /auth/login con las credenciales del ATACANTE. Es una peticion simple
    // (sin preflight), asi que CORS no la para, y al atacante no le hace
    // falta leer la respuesta: le basta con que el navegador de la victima se
    // quede logueado en su cuenta. La defensa es no entender ese formato.
    //
    // Se mandan credenciales VALIDAS a proposito: si algun dia se reactivara
    // express.urlencoded, esto seria un 200 con Set-Cookie y el test caeria.
    // Con credenciales falsas el test pasaria por el motivo equivocado.
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .type('form')
      .send({ login: LOGIN, password: PASSWORD });

    expect(res.status).not.toBe(200);
    // Lo que de verdad importa no es el status, es que no salga sesion.
    expect(res.headers['set-cookie']).toBeUndefined();

    // Y el mismo login por JSON si funciona: confirma que el rechazo de
    // arriba es por el formato del body y no porque el usuario o la
    // contrasena esten mal.
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ login: LOGIN, password: PASSWORD })
      .expect(200);
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

    // El revert va en un finally: el usuario es compartido por el resto del
    // archivo (y por cualquier test futuro que se agregue). Si una
    // aserticion de aqui adentro fallara y el revert no corriera en un
    // finally, el usuario quedaria dado de baja el resto de la corrida y un
    // fallo real en este bloque cascadearia en fallos falsos en tests
    // posteriores que ni tocan deleted_at.
    try {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ login: LOGIN, password: PASSWORD })
        .expect(401);
      expect((res.body as RespuestaError).message).toBe(
        'Credenciales invalidas.',
      );
    } finally {
      await db
        .updateTable('usuario')
        .set({ deleted_at: null })
        .where('id', '=', usuarioId)
        .execute();
    }

    // No basta con confirmar que corrio el UPDATE: se confirma la reversion
    // real dejando que el usuario vuelva a poder loguearse. Si el UPDATE de
    // arriba fallara silenciosamente (o el filtro `deleted_at is null` de
    // AuthService quedara mal escrito), este login seguiria dando 401. Va
    // fuera del finally a proposito: si el revert fallo, queremos que el
    // test siga fallando (no que este segundo login enmascare el problema).
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ login: LOGIN, password: PASSWORD })
      .expect(200);
  });

  it('dar de baja a un usuario corta una sesion YA ABIERTA: su refresh deja de rotar', async () => {
    // Esto es una invariante distinta de "un usuario dado de baja no puede
    // entrar" (el test de arriba). Aquella solo cubre /auth/login. Sin
    // comprobar la baja en la rotacion, un usuario ya logueado seguiria
    // renovando su refresh indefinidamente — cada rotacion emite una sesion
    // nueva de 12 h — y conservaria acceso a la API para siempre.
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ login: LOGIN, password: PASSWORD })
      .expect(200);

    const cookies = login.headers['set-cookie'] as unknown as string[];
    const acceso = leerCookie(cookies, 'jawa_access');
    const refresh = leerCookie(cookies, 'jawa_refresh');

    // Se confirma que la sesion estaba viva ANTES de la baja: si no, el 401
    // de abajo podria venir de una sesion que nunca funciono.
    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Cookie', [`jawa_access=${acceso}`])
      .expect(200);

    await db
      .updateTable('usuario')
      .set({ deleted_at: new Date() })
      .where('id', '=', usuarioId)
      .execute();

    // Revert en finally, igual que el test de baja de arriba: el usuario es
    // compartido por todo el archivo y un fallo aqui dentro no debe dejar la
    // base sucia ni cascadear en fallos falsos.
    try {
      const res = await request(app.getHttpServer())
        .post('/auth/refresh')
        .set('Cookie', [`jawa_refresh=${refresh}`])
        .expect(401);
      expect((res.body as RespuestaError).message).toBe('Sesion invalida.');
    } finally {
      await db
        .updateTable('usuario')
        .set({ deleted_at: null })
        .where('id', '=', usuarioId)
        .execute();
    }

    // Restaurado el usuario, el MISMO refresh vuelve a rotar. Dos cosas a la
    // vez: que el 401 de arriba fue por la baja (y no porque el token ya
    // estuviera quemado por otra razon), y que la rama de baja NO revoca la
    // cadena — decision deliberada documentada en TokenService.rotarRefresh.
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', [`jawa_refresh=${refresh}`])
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
  // Este caso cubre la defensa EN PROFUNDIDAD, no la principal: el schema de
  // configuracion (configuracion.schema.ts) ya impide arrancar el AppModule
  // sin JWT_SECRET, y eso se prueba en configuracion.e2e-spec.ts. Lo de aqui
  // es el chequeo a mano de auth.module.ts, que es lo unico que protege a
  // AuthModule cuando se monta SIN ese ConfigModule — como hace este mismo
  // test, y como podria hacer cualquier app futura.
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
      // proceso de Jest comparten process.env. Si originalmente no estaba
      // definida, hay que borrar la clave (no asignarle la cadena literal
      // "undefined", que es lo que haria `process.env.X = undefined`).
      if (original === undefined) {
        delete process.env.JWT_SECRET;
      } else {
        process.env.JWT_SECRET = original;
      }
    }
  });
});
