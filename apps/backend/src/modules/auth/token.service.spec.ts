import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { DatabaseModule } from '../../database/database.module';
import { DB_CONNECTION, type Database } from '../../database/database.tokens';
import { PasswordService } from './password.service';
import { SesionRepository } from './sesion.repository';
import { TokenService, TokenInvalidoError } from './token.service';

describe('TokenService', () => {
  let moduleRef: TestingModule;
  let servicio: TokenService;
  let db: Database;
  let usuarioId: string;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          envFilePath: ['../../.env.test', '../../.env'],
        }),
        DatabaseModule,
        JwtModule.register({
          secret: process.env.JWT_SECRET ?? 'secreto-de-prueba',
        }),
      ],
      providers: [TokenService, SesionRepository, PasswordService],
    }).compile();

    servicio = moduleRef.get(TokenService);
    db = moduleRef.get<Database>(DB_CONNECTION);

    const perfil = await db
      .selectFrom('perfil')
      .select('id')
      .orderBy('nombre')
      .executeTakeFirstOrThrow();

    const usuario = await db
      .insertInto('usuario')
      .values({
        login: `prueba-tokens-${Date.now()}`,
        nombre: 'Usuario de prueba',
        password_hash: await new PasswordService().hashear('x'),
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
    await moduleRef.close();
  });

  it('el token de acceso lleva el id del usuario y el tipo', () => {
    const token = servicio.emitirAcceso(usuarioId);
    const payload = servicio.verificarAcceso(token);
    expect(payload.sub).toBe(usuarioId);
    expect(payload.tipo).toBe('usuario');
  });

  it('rechaza un token de acceso manipulado', () => {
    expect(() => servicio.verificarAcceso('esto.no.es-un-jwt')).toThrow(
      TokenInvalidoError,
    );
  });

  it('guarda el refresh token hasheado, nunca en claro', async () => {
    const refresh = await servicio.emitirRefresh(usuarioId);
    const filas = await db
      .selectFrom('sesion_refresh')
      .select('token_hash')
      .where('usuario_id', '=', usuarioId)
      .execute();
    expect(filas.some((f) => f.token_hash === refresh)).toBe(false);
  });

  it('al rotar emite un refresh nuevo y revoca el anterior', async () => {
    const original = await servicio.emitirRefresh(usuarioId);
    const rotado = await servicio.rotarRefresh(original);

    expect(rotado.refresh).not.toBe(original);
    expect(rotado.usuarioId).toBe(usuarioId);
    await expect(servicio.rotarRefresh(original)).rejects.toThrow(
      TokenInvalidoError,
    );
  });

  it('reusar un refresh ya rotado revoca toda la cadena del usuario', async () => {
    const original = await servicio.emitirRefresh(usuarioId);
    const rotado = await servicio.rotarRefresh(original);

    // Un atacante intenta el token viejo...
    await expect(servicio.rotarRefresh(original)).rejects.toThrow(
      TokenInvalidoError,
    );

    // ...y eso tambien invalida la sesion legitima.
    await expect(servicio.rotarRefresh(rotado.refresh)).rejects.toThrow(
      TokenInvalidoError,
    );
  });

  it('rechaza un refresh vencido', async () => {
    const refresh = await servicio.emitirRefresh(usuarioId);
    await db
      .updateTable('sesion_refresh')
      .set({ expira_en: new Date(Date.now() - 1000) })
      .where('usuario_id', '=', usuarioId)
      .where('revocada_en', 'is', null)
      .execute();

    await expect(servicio.rotarRefresh(refresh)).rejects.toThrow(
      TokenInvalidoError,
    );
  });

  it('revocar cierra la sesion', async () => {
    const refresh = await servicio.emitirRefresh(usuarioId);
    await servicio.revocarRefresh(refresh);
    await expect(servicio.rotarRefresh(refresh)).rejects.toThrow(
      TokenInvalidoError,
    );
  });

  it('rechaza un refresh que nunca existio', async () => {
    await expect(servicio.rotarRefresh('token-inventado')).rejects.toThrow(
      TokenInvalidoError,
    );
  });
});
