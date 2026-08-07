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
