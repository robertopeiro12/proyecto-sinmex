import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { COOKIE_ACCESO } from './../src/modules/auth/cookies';

interface RespuestaError {
  message: string;
}

describe('Health y guard global de sesion (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    // main.ts registra cookie-parser en el bootstrap real; aqui se registra
    // a mano porque createNestApplication() no pasa por main.ts. Sin esto
    // req.cookies queda undefined y el caso de la cookie basura no puede
    // ejercer la rama de verificarAcceso() del guard.
    app.use(cookieParser());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('/health responde sin sesion (endpoint publico)', () => {
    return request(app.getHttpServer()).get('/health').expect(200);
  });

  it('un endpoint inexistente sigue devolviendo 404, no 401', () => {
    return request(app.getHttpServer()).get('/no-existe').expect(404);
  });

  // Estos dos casos existen para pinchar especificamente al guard, no a
  // @UsuarioActual(): ese decorador tambien lanza 401 si falta
  // req.usuarioId ('Sesion invalida.'), asi que un test que solo exigiera
  // 401 seguiria en verde si se borrara JwtAuthGuard de app.module.ts. Se
  // exige el mensaje que solo emite el guard para que la prueba dependa de
  // que el guard exista.
  it('/auth/me sin cookie de acceso da 401 con el mensaje del guard (no del decorador)', () => {
    return request(app.getHttpServer())
      .get('/auth/me')
      .expect(401)
      .expect((res) => {
        expect((res.body as RespuestaError).message).toBe('Sin sesion.');
      });
  });

  it('/auth/me con una cookie de acceso invalida da 401 con el mensaje de token invalido del guard', () => {
    return request(app.getHttpServer())
      .get('/auth/me')
      .set('Cookie', `${COOKIE_ACCESO}=esto-no-es-un-jwt-valido`)
      .expect(401)
      .expect((res) => {
        expect((res.body as RespuestaError).message).toBe(
          'Sesion invalida o vencida.',
        );
      });
  });
});
