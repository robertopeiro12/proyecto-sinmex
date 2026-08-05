import type { Test as TipoTest, TestingModule } from '@nestjs/testing';

/**
 * Arranque del backend con configuracion invalida.
 *
 * Se compila el AppModule REAL, no una copia del ConfigModule: lo que hay que
 * probar es que el schema esta enchufado donde arranca la aplicacion, no que
 * Joi sabe validar.
 *
 * Dos detalles del andamiaje, ambos obligados:
 *
 * 1. jest.resetModules() + require en vez de un import arriba. ConfigModule
 *    .forRoot() se ejecuta al EVALUAR el decorador @Module de app.module.ts,
 *    o sea al importarlo, una sola vez por proceso. Con un import normal, la
 *    validacion ya habria corrido con el entorno bueno antes de que el test
 *    pudiera cambiar nada.
 * 2. @nestjs/testing tambien se requiere despues del reset. Si se importara
 *    arriba, su Reflector vendria del registro de modulos viejo y el del
 *    AppModule recien cargado del nuevo: Nest los ve como clases distintas y
 *    falla a resolver JwtAuthGuard por un motivo que no tiene nada que ver
 *    con lo que se esta probando.
 *
 * forRoot() es `async`, asi que el error de validacion llega como promesa
 * rechazada y solo se materializa cuando Nest la espera al compilar. Por eso
 * el assert es sobre compile() y no sobre el require.
 */
const compilarAppModule = async (): Promise<TestingModule> => {
  jest.resetModules();
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { AppModule } = require('./../src/app.module') as { AppModule: never };
  const { Test } = require('@nestjs/testing') as { Test: typeof TipoTest };
  /* eslint-enable @typescript-eslint/no-require-imports */
  return Test.createTestingModule({ imports: [AppModule] }).compile();
};

/** Pone la variable, corre el caso y la deja como estaba pase lo que pase. */
const conVariable = async (
  nombre: string,
  valor: string,
  caso: () => Promise<void>,
): Promise<void> => {
  const original = process.env[nombre];
  process.env[nombre] = valor;
  try {
    await caso();
  } finally {
    if (original === undefined) {
      delete process.env[nombre];
    } else {
      process.env[nombre] = original;
    }
  }
};

describe('Validacion de la configuracion al arrancar (e2e)', () => {
  afterAll(() => {
    // No dejar el registro de modulos reseteado para el resto del worker.
    jest.resetModules();
  });

  it('arranca con la configuracion del entorno de pruebas', async () => {
    // Ancla de control: sin esto, los casos negativos de abajo podrian estar
    // pasando porque el AppModule no compila NUNCA, por cualquier motivo, y
    // el archivo entero seguiria en verde sin probar nada.
    const moduleRef = await compilarAppModule();
    await moduleRef.close();
  });

  it('no arranca con COOKIE_SAMESITE=none (apagaria la unica defensa CSRF)', async () => {
    await conVariable('COOKIE_SAMESITE', 'none', async () => {
      // 'none' es un valor legal de la spec de cookies, y es justo lo que uno
      // pone cuando el portal y la API quedan en dominios distintos y las
      // cookies dejan de viajar. Sin token CSRF eso deja el sistema abierto:
      // mejor no arrancar. Ver README, "Requisito de despliegue".
      await expect(compilarAppModule()).rejects.toThrow(/COOKIE_SAMESITE/);
    });
  });

  it('no arranca con REFRESH_TOKEN_TTL_HORAS vacio (crearia sesiones ya vencidas)', async () => {
    await conVariable('REFRESH_TOKEN_TTL_HORAS', '', async () => {
      // El default de @nestjs/config solo cubre undefined, no la cadena
      // vacia. Sin validacion, un `REFRESH_TOKEN_TTL_HORAS=` en un .env
      // copiado daba Number('') === 0: las sesiones nacian vencidas, el login
      // parecia funcionar y despues todo devolvia 401 sin ninguna pista.
      await expect(compilarAppModule()).rejects.toThrow(
        /REFRESH_TOKEN_TTL_HORAS/,
      );
    });
  });

  it('no arranca con un ACCESS_TOKEN_TTL con formato invalido', async () => {
    await conVariable('ACCESS_TOKEN_TTL', '15min', async () => {
      // "15min" no lo entiende la libreria 'ms'. jsonwebtoken no lanza al
      // verificar sino al FIRMAR, o sea en cada login y ya en produccion.
      await expect(compilarAppModule()).rejects.toThrow(/ACCESS_TOKEN_TTL/);
    });
  });

  it('no arranca con un JWT_SECRET demasiado corto', async () => {
    await conVariable('JWT_SECRET', 'corto', async () => {
      await expect(compilarAppModule()).rejects.toThrow(/JWT_SECRET/);
    });
  });

  it('no arranca con JWT_SECRET vacio', async () => {
    await conVariable('JWT_SECRET', '', async () => {
      await expect(compilarAppModule()).rejects.toThrow(/JWT_SECRET/);
    });
  });
});
