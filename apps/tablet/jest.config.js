// Pruebas de la logica que NO depende de React Native:
//
// - `src/datos/`     — migraciones y repositorios (T-04). Hablan contra la
//                      interfaz `BaseDatos` y en pruebas reciben el driver de
//                      `better-sqlite3` en vez de `expo-sqlite`. Ver ADR-0004.
// - `src/seguridad/` — SHA-256, PBKDF2 y el verificador local de la contrasena
//                      (T-06). TypeScript puro, contrastado contra
//                      `node:crypto`. Ver ADR-0005.
// - `src/sesion/`    — la politica de la sesion offline (T-06): funciones puras
//                      sobre un reloj inyectado, y el almacen contra una
//                      interfaz que en pruebas es memoria en vez de
//                      `expo-secure-store`.
//
// Corren en Node puro con ts-jest, no con `jest-expo`, porque ninguna de esas
// carpetas importa React Native. Las pruebas de componentes/pantallas (que si
// necesitarian jest-expo y el transform de RN) siguen fuera de alcance.
/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.spec.ts'],
  // El default de Jest son 5 s, y no bastan aqui. `derivarVerificador` corre
  // PBKDF2 con 60 000 iteraciones en TypeScript puro (ADR-0005): medido, un
  // solo test llega a **1.3 s en una maquina ociosa**, y varias pruebas del
  // gestor derivan mas de un verificador. Con el CI cargado —o con un
  // `typecheck` corriendo en paralelo, que es como aparecio— se pasa de 5 s y
  // la suite falla de forma intermitente sin que nada este roto.
  //
  // No es un parche para un test lento: es que el coste del KDF ES el
  // comportamiento que se prueba, y no se puede bajar sin dejar de probarlo.
  testTimeout: 30_000,
  // El alias `@/` de tsconfig.json. Jest no lee `paths` de TypeScript: sin
  // esto, `src/datos/` seguia funcionando (usa rutas relativas) pero cualquier
  // import con alias reventaba solo al ejecutar las pruebas, no al compilar.
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: {
          module: 'commonjs',
          moduleResolution: 'node',
          esModuleInterop: true,
          strict: true,
          target: 'ES2022',
          types: ['jest', 'node'],
        },
      },
    ],
  },
};
