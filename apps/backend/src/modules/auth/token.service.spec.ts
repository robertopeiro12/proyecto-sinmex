import { createHash } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
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
          // '||' (no '??'): un JWT_SECRET vacio en el entorno tambien debe
          // caer al default, no solo ausente/undefined.
          secret: process.env.JWT_SECRET || 'secreto-de-prueba',
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

    // Propiedad real, no solo "no es igual al plano": el hash guardado debe
    // ser el SHA-256 del token. Una transformacion reversible cualquiera
    // tambien pasaria la asercion de arriba sin ser lo que se pide.
    const hashEsperado = createHash('sha256').update(refresh).digest('hex');
    expect(filas.some((f) => f.token_hash === hashEsperado)).toBe(true);
  });

  it('al rotar emite un refresh nuevo y revoca el anterior', async () => {
    const original = await servicio.emitirRefresh(usuarioId);
    const rotado = await servicio.rotarRefresh(original);

    expect(rotado.refresh).not.toBe(original);
    expect(rotado.usuarioId).toBe(usuarioId);

    // La fila vieja debe quedar encadenada a la nueva, no solo revocada: si
    // reemplazada_por se perdiera (p.ej. por el bug del default null en
    // revocar()), esto no lo notaria ninguna otra asercion del archivo.
    const hashOriginal = createHash('sha256').update(original).digest('hex');
    const hashRotado = createHash('sha256')
      .update(rotado.refresh)
      .digest('hex');
    const filaVieja = await db
      .selectFrom('sesion_refresh')
      .select('reemplazada_por')
      .where('token_hash', '=', hashOriginal)
      .executeTakeFirstOrThrow();
    const filaNueva = await db
      .selectFrom('sesion_refresh')
      .select('id')
      .where('token_hash', '=', hashRotado)
      .executeTakeFirstOrThrow();
    expect(filaVieja.reemplazada_por).toBe(filaNueva.id);

    // El refresh recien emitido debe servir de verdad: si crear() guardara
    // el hash equivocado, los 8 tests originales seguirian en verde pero
    // esta segunda rotacion fallaria.
    const segundaRotacion = await servicio.rotarRefresh(rotado.refresh);
    expect(segundaRotacion.usuarioId).toBe(usuarioId);
    expect(segundaRotacion.refresh).not.toBe(rotado.refresh);

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

    // Propiedad real: no basta con que ambos intentos hayan sido rechazados,
    // ninguna sesion del usuario debe seguir viva.
    const vivas = await db
      .selectFrom('sesion_refresh')
      .select('id')
      .where('usuario_id', '=', usuarioId)
      .where('revocada_en', 'is', null)
      .execute();
    expect(vivas).toHaveLength(0);
  });

  it('dos rotaciones concurrentes del mismo refresh: solo una gana y no queda ninguna sesion viva', async () => {
    const original = await servicio.emitirRefresh(usuarioId);

    // Se disparan a la vez, sin esperar una antes de la otra: si hay una
    // carrera TOCTOU (leer la sesion, luego revocarla, sin serializar), esto
    // la expone. El punto de serializacion real es el UPDATE condicional en
    // revocarSiViva(), no el orden en que se lanzan estas dos promesas.
    const resultados = await Promise.allSettled([
      servicio.rotarRefresh(original),
      servicio.rotarRefresh(original),
    ]);

    const exitosas = resultados.filter((r) => r.status === 'fulfilled');
    const fallidas = resultados.filter((r) => r.status === 'rejected');
    expect(exitosas).toHaveLength(1);
    expect(fallidas).toHaveLength(1);
    const [perdedora] = fallidas;
    if (perdedora.status !== 'rejected') {
      throw new Error('se esperaba una promesa rechazada');
    }
    expect(perdedora.reason).toBeInstanceOf(TokenInvalidoError);

    // La sesion nueva de la llamada ganadora tambien debe quedar revocada:
    // el reuso concurrente corta TODA la cadena, incluida la rama "legitima".
    const vivas = await db
      .selectFrom('sesion_refresh')
      .select('id')
      .where('usuario_id', '=', usuarioId)
      .where('revocada_en', 'is', null)
      .execute();
    expect(vivas).toHaveLength(0);
  });

  it('rechaza un token de acceso con tipo distinto de usuario (p.ej. vendedor)', () => {
    // Firmado con el mismo secreto que usa el servicio, pero para otro actor
    // (la futura app de tablet). No debe ser aceptado en el portal.
    const jwt = moduleRef.get(JwtService);
    const tokenVendedor = jwt.sign({ sub: usuarioId, tipo: 'vendedor' });
    expect(() => servicio.verificarAcceso(tokenVendedor)).toThrow(
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

  it('rechaza rotar el refresh de un usuario dado de baja, sin revocarle la cadena', async () => {
    const refresh = await servicio.emitirRefresh(usuarioId);

    await db
      .updateTable('usuario')
      .set({ deleted_at: new Date() })
      .where('id', '=', usuarioId)
      .execute();

    try {
      await expect(servicio.rotarRefresh(refresh)).rejects.toThrow(
        TokenInvalidoError,
      );

      // La baja no es un robo de token: se rechaza, pero no se corta la
      // cadena. La sesion sigue viva en la base (ver el comentario de
      // rotarRefresh); lo que la vuelve inutil es el chequeo, no un UPDATE.
      const vivas = await db
        .selectFrom('sesion_refresh')
        .select('id')
        .where('usuario_id', '=', usuarioId)
        .where('revocada_en', 'is', null)
        .execute();
      expect(vivas.length).toBeGreaterThan(0);
    } finally {
      await db
        .updateTable('usuario')
        .set({ deleted_at: null })
        .where('id', '=', usuarioId)
        .execute();
    }

    // Restaurado el usuario, el mismo refresh vuelve a rotar: confirma que el
    // rechazo de arriba lo causo la baja y no un efecto colateral.
    const rotado = await servicio.rotarRefresh(refresh);
    expect(rotado.usuarioId).toBe(usuarioId);
  });

  it('rechaza un refresh que nunca existio', async () => {
    await expect(servicio.rotarRefresh('token-inventado')).rejects.toThrow(
      TokenInvalidoError,
    );
  });
});
