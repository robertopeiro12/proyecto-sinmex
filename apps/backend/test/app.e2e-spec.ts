import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

describe('Health (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
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
});
