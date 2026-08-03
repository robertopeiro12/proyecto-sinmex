import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './database.module';
import { DB_CONNECTION, type Database } from './database.tokens';

describe('DatabaseModule', () => {
  it('provee un cliente Kysely que consulta la base real', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          envFilePath: ['../../.env.test', '../../.env'],
        }),
        DatabaseModule,
      ],
    }).compile();

    const db = moduleRef.get<Database>(DB_CONNECTION);
    const perfiles = await db.selectFrom('perfil').selectAll().execute();

    // Las semillas de T-05 insertan 6 perfiles.
    expect(perfiles).toHaveLength(6);

    await moduleRef.close();
  });
});
