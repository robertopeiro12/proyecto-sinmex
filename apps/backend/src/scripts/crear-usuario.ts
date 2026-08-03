/**
 * Alta manual de un usuario del portal.
 * Existe porque el CRUD de usuarios es T-13; sirve tambien para altas de
 * emergencia en produccion. Uso:
 *   npm run crear-usuario --workspace=apps/backend
 */
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { config as cargarEnv } from 'dotenv';
import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { PasswordService } from '../modules/auth/password.service';
import type { DB } from '../database/schema';

cargarEnv({ path: `../../.env.${process.env.NODE_ENV ?? 'development'}` });

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('Falta DATABASE_URL.');
  }

  const db = new Kysely<DB>({
    dialect: new PostgresDialect({ pool: new Pool({ connectionString }) }),
  });
  const rl = createInterface({ input: stdin, output: stdout });

  try {
    const perfiles = await db
      .selectFrom('perfil')
      .select(['id', 'nombre'])
      .where('deleted_at', 'is', null)
      .orderBy('nombre')
      .execute();
    const sucursales = await db
      .selectFrom('sucursal')
      .select(['id', 'codigo', 'nombre'])
      .where('deleted_at', 'is', null)
      .orderBy('codigo')
      .execute();

    console.log('\nPerfiles:', perfiles.map((p) => p.nombre).join(' | '));
    console.log(
      'Sucursales:',
      [...sucursales.map((s) => s.codigo), 'GENERAL'].join(' | '),
      '\n',
    );

    const login = (await rl.question('Login: ')).trim();
    const nombre = (await rl.question('Nombre: ')).trim();
    const contrasena = (await rl.question('Contrasena: ')).trim();
    const nombrePerfil = (await rl.question('Perfil: ')).trim();
    const codigoSucursal = (await rl.question('Sucursal (o GENERAL): '))
      .trim()
      .toUpperCase();

    if (!login || !nombre || !contrasena) {
      throw new Error('Login, nombre y contrasena son obligatorios.');
    }

    const perfil = perfiles.find((p) => p.nombre === nombrePerfil);
    if (!perfil) {
      throw new Error(`No existe el perfil "${nombrePerfil}".`);
    }

    let sucursalId: string | null = null;
    if (codigoSucursal !== 'GENERAL') {
      const sucursal = sucursales.find((s) => s.codigo === codigoSucursal);
      if (!sucursal) {
        throw new Error(`No existe la sucursal "${codigoSucursal}".`);
      }
      sucursalId = sucursal.id;
    }

    const yaExiste = await db
      .selectFrom('usuario')
      .select('id')
      .where('login', '=', login)
      .executeTakeFirst();
    if (yaExiste) {
      throw new Error(`Ya existe un usuario con login "${login}".`);
    }

    const passwordHash = await new PasswordService().hashear(contrasena);

    const creado = await db
      .insertInto('usuario')
      .values({
        login,
        nombre,
        password_hash: passwordHash,
        perfil_id: perfil.id,
        sucursal_id: sucursalId,
      })
      .returning(['id', 'login'])
      .executeTakeFirstOrThrow();

    console.log(`\n✅ Usuario "${creado.login}" creado (${creado.id}).`);
  } finally {
    rl.close();
    await db.destroy();
  }
}

main().catch((error: unknown) => {
  console.error(
    `\n❌ ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
