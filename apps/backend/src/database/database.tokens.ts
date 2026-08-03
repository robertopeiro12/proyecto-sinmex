import type { Kysely } from 'kysely';
import type { DB } from './schema';

/** Token de inyección del cliente Kysely. */
export const DB_CONNECTION = 'DB_CONNECTION';

/** Tipo que inyectan los repositorios. */
export type Database = Kysely<DB>;
