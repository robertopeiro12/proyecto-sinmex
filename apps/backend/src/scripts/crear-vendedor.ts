/**
 * Alta manual de las credenciales de un [[Vendedor]] (app de tablet).
 *
 * Existe por el mismo motivo que `crear-usuario`: el CRUD de vendedores es
 * **T-62** y hasta entonces no hay forma de dar de alta a nadie en la app.
 * Sirve tambien para altas de emergencia y para **restablecer una contrasena**
 * (si el login ya existe, la actualiza en vez de fallar — un vendedor que
 * olvida su contrasena en ruta es un caso real, y no tener como resolverlo
 * dejaria a alguien sin trabajar).
 *
 * Uso:
 *   npm run crear-vendedor --workspace=apps/backend
 *
 * Ojo con a que base apunta: usa `.env.development`, que segun el CLAUDE.md del
 * repo es **`sinmex dev` en la nube**, no el Postgres local.
 */
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { config as cargarEnv } from 'dotenv';
import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { PasswordService } from '../modules/auth/password.service';
import { candidatosDeSegmento } from '../modules/sincronizacion/segmento-vendedor';
import type { DB } from '../database/schema';

cargarEnv({
  path: `../../.env.${process.env.NODE_ENV ?? 'development'}`,
  quiet: true,
});

type EscritorSalida = (chunk: string | Uint8Array) => boolean;

/**
 * Pregunta sin hacer eco de lo tecleado. Misma tecnica y mismo motivo que en
 * `crear-usuario.ts` (readline no permite apagar el eco por si solo); alli esta
 * el comentario extenso.
 */
async function preguntarOculto(
  rl: ReturnType<typeof createInterface>,
  prompt: string,
): Promise<string> {
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
    const sucursales = await db
      .selectFrom('sucursal')
      .select(['id', 'codigo', 'nombre'])
      .where('deleted_at', 'is', null)
      .orderBy('codigo')
      .execute();

    console.log(
      '\nSucursales:',
      sucursales.map((s) => s.codigo).join(' | '),
      '\n',
    );

    // Mismo trato que CrearVendedorDto (T-62): el login se normaliza a
    // minusculas al escribir, para que el indice parcial insensible a
    // mayusculas (uq_vendedor_login) diga la verdad sin importar por que
    // puerta entro el alta.
    const login = (await rl.question('Login del vendedor: '))
      .trim()
      .toLowerCase();
    const contrasena = (await preguntarOculto(rl, 'Contrasena: ')).trim();

    if (!login || !contrasena) {
      throw new Error('Login y contrasena son obligatorios.');
    }

    const passwordHash = await new PasswordService().hashear(contrasena);

    // Se busca solo entre los vivos: T-62 (uq_vendedor_login, indice
    // parcial) libera el login al dar de baja, igual que T-13 hizo con
    // usuario.login (crear-usuario.ts). Sin el filtro de deleted_at, este
    // script se negaria a reusar un login que la base ya permite reusar,
    // apuntando a una restauracion desde el portal que T-62 no construyo
    // (ver spec, "Fuera, a proposito").
    const existente = await db
      .selectFrom('vendedor')
      .select(['id', 'nombre'])
      .where('login', '=', login)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();

    if (existente) {
      const confirmar = (
        await rl.question(
          `El vendedor "${existente.nombre}" ya existe. ¿Restablecer su contrasena? (s/N): `,
        )
      )
        .trim()
        .toLowerCase();
      if (confirmar !== 's') {
        console.log('\nCancelado.');
        return;
      }

      await db
        .updateTable('vendedor')
        .set({ password_hash: passwordHash })
        .where('id', '=', existente.id)
        .execute();

      // La contrasena vieja deja de servir, asi que las sesiones abiertas con
      // ella tampoco deben seguir. Sin esto, una tablet robada que ya tuviera
      // sesion seguiria renovandola pese al cambio de contrasena — que es
      // justo el motivo mas probable para restablecerla.
      const revocadas = await db
        .updateTable('sesion_vendedor')
        .set({ revocada_en: new Date() })
        .where('vendedor_id', '=', existente.id)
        .where('revocada_en', 'is', null)
        .executeTakeFirst();

      console.log(
        `\n✅ Contrasena de "${login}" restablecida. Sesiones revocadas: ${revocadas.numUpdatedRows}.`,
      );
      console.log(
        '   La tablet exigira un login CON RED la proxima vez: su verificador local ya no coincide.',
      );
      return;
    }

    const nombre = (await rl.question('Nombre completo: ')).trim();
    const codigoSucursal = (await rl.question('Sucursal: '))
      .trim()
      .toUpperCase();

    if (!nombre) {
      throw new Error('El nombre es obligatorio.');
    }

    const sucursal = sucursales.find((s) => s.codigo === codigoSucursal);
    if (!sucursal) {
      throw new Error(`No existe la sucursal "${codigoSucursal}".`);
    }

    // El 5o segmento de su [[Folios|folio]] (T-14).
    //
    // Se asigna AQUI y no en la tablet porque la tablet no puede: del `pull`
    // solo baja su propia ficha, asi que no ve a sus companeros. Se **pina**
    // en vez de recalcularse: un folio emitido no se corrige hacia atras.
    //
    // T-62 (enmienda de ADR-0007, confirmada por el cliente): si las
    // iniciales ya estan tomadas por otro vendedor de la MISMA
    // sucursal, el alta se RECHAZA -- ya no se cede a la siguiente
    // combinacion como hacia la version anterior de este script. Mismo
    // criterio, sin consulta previa: se intenta el insert con el primer
    // candidato y se distingue el error por su `constraint`.
    const segmento = candidatosDeSegmento(nombre)[0];

    try {
      const creado = await db
        .insertInto('vendedor')
        .values({
          login,
          nombre,
          password_hash: passwordHash,
          sucursal_id: sucursal.id,
          folio_segmento: segmento,
        })
        .returning(['id', 'login'])
        .executeTakeFirstOrThrow();

      console.log(`\n✅ Vendedor "${creado.login}" creado (${creado.id}).`);
      console.log(
        `   Segmento de folio: ${segmento} (p. ej. ${sucursal.codigo}260807${segmento}01).`,
      );
    } catch (error) {
      const codigo =
        typeof error === 'object' && error !== null && 'code' in error
          ? (error as { code?: unknown }).code
          : undefined;
      const constraint =
        typeof error === 'object' && error !== null && 'constraint' in error
          ? (error as { constraint?: unknown }).constraint
          : undefined;

      if (codigo === '23505' && constraint === 'uq_vendedor_folio_segmento') {
        throw new Error(
          `Ya hay un vendedor en "${sucursal.codigo}" con las iniciales "${segmento}". ` +
            'Da de alta a este vendedor con un nombre que no choque (mismo criterio que usa el portal, T-62).',
        );
      }
      throw error;
    }
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
