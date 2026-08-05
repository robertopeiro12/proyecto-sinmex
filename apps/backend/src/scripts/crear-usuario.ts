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

// quiet: true evita el banner promocional que dotenv imprime en cada corrida
// (ruido en una herramienta de consola pensada para produccion).
cargarEnv({
  path: `../../.env.${process.env.NODE_ENV ?? 'development'}`,
  quiet: true,
});

/**
 * Como rl.question(), pero sin hacer eco de lo que se teclea: se usa para la
 * contrasena, que no debe quedar visible en pantalla, scrollback ni en una
 * grabacion/pantalla compartida.
 *
 * readline (modo terminal) escribe el prompt y luego, caracter por caracter,
 * el eco de lo tecleado, todo via `stdout.write`. No hay una opcion publica
 * de readline para desactivar solo el eco, asi que interceptamos
 * temporalmente `stdout.write`: dejamos pasar la escritura hasta que
 * aparezca el texto del prompt (para que se vea "Contrasena: ") y silenciamos
 * todo lo que venga despues, que son los caracteres tecleados. Al terminar
 * restauramos `stdout.write` y agregamos el salto de linea que se
 * silencio, para que la siguiente pregunta no quede pegada.
 */
// readline solo llama a output.write(chunk) con un unico argumento (sin
// encoding ni callback); acotamos el tipo a eso para no heredar el `any`
// que trae el tipo completo (y sobrecargado) de stdout.write.
type EscritorSalida = (chunk: string | Uint8Array) => boolean;

async function preguntarOculto(
  rl: ReturnType<typeof createInterface>,
  prompt: string,
): Promise<string> {
  // Capturamos y atamos el valor original de la funcion (no una que vuelva a
  // leer stdout.write en cada llamada): si no, al restaurar/llamar despues de
  // reasignar stdout.write, terminaria llamandose a si misma. El cast a
  // EscritorSalida evita heredar el `any` que trae bind() sobre una funcion
  // con firmas sobrecargadas.
  const escribirOriginal = stdout.write.bind(stdout) as EscritorSalida;
  let promptListo = false;
  const escritorSilenciado: EscritorSalida = (chunk) => {
    const texto = typeof chunk === 'string' ? chunk : chunk.toString();
    if (!promptListo) {
      if (texto.includes(prompt)) {
        promptListo = true;
      }
      return escribirOriginal(chunk);
    }
    return true;
  };
  stdout.write = escritorSilenciado;

  try {
    return await rl.question(prompt);
  } finally {
    // Restaurar stdout.write pase lo que pase, incluso si rl.question() revienta.
    stdout.write = escribirOriginal;
    stdout.write('\n');
  }
}

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
    const contrasena = (await preguntarOculto(rl, 'Contrasena: ')).trim();
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
