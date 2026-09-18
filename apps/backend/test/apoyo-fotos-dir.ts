import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Apunta `FOTOS_DIR` a un directorio temporal propio de este proceso de Jest.
 *
 * > [!danger] Esto tiene que correr ANTES de importar `app.module.ts`
 * > `ConfigModule.forRoot()` se ejecuta al EVALUAR el decorador `@Module` de
 * > `app.module.ts`, o sea al importarlo (lo documenta `configuracion.e2e-spec.ts`),
 * > y los `import` de ES se hoistean. Ponerlo en un `beforeAll` llegaria tarde:
 * > la configuracion ya estaria leida, y las pruebas escribirian en el
 * > `var/fotos` de desarrollo. Por eso vive en un modulo aparte que se importa
 * > **primero** y hace su trabajo como efecto secundario.
 *
 * Un directorio distinto por proceso (`mkdtemp`) y no uno fijo: Jest corre los
 * archivos e2e en paralelo, en procesos distintos, y el `afterAll` de una suite
 * borraria las fotos que otra todavia esta comprobando. Es el mismo motivo del
 * `SUFIJO` con PID que usan las demas suites para las filas de la base.
 */
export const FOTOS_DIR_PRUEBA = mkdtempSync(join(tmpdir(), 'jawa-fotos-e2e-'));

process.env.FOTOS_DIR = FOTOS_DIR_PRUEBA;
