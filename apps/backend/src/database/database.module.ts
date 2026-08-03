import { Global, Inject, Module, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { DB_CONNECTION, type Database } from './database.tokens';
import type { DB } from './schema';

@Global()
@Module({
  providers: [
    {
      provide: DB_CONNECTION,
      inject: [ConfigService],
      useFactory: (config: ConfigService): Database => {
        const connectionString = config.get<string>('DATABASE_URL');
        if (!connectionString) {
          throw new Error(
            'Falta DATABASE_URL: el backend no puede conectarse a Postgres.',
          );
        }
        return new Kysely<DB>({
          dialect: new PostgresDialect({
            pool: new Pool({ connectionString }),
          }),
        });
      },
    },
  ],
  exports: [DB_CONNECTION],
})
export class DatabaseModule implements OnModuleDestroy {
  constructor(@Inject(DB_CONNECTION) private readonly db: Database) {}

  /** Cierra el pool para que Jest no quede colgado al terminar la suite. */
  async onModuleDestroy(): Promise<void> {
    await this.db.destroy();
  }
}
