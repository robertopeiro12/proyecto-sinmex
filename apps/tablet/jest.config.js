// Pruebas de la CAPA DE DATOS unicamente (migraciones + repositorios).
//
// Corren en Node puro con ts-jest, no con `jest-expo`: el codigo de `src/datos/`
// no importa nada de React Native, habla contra la interfaz `BaseDatos`
// (src/datos/base-datos.ts) y en pruebas se le inyecta el driver de
// `better-sqlite3` en vez de `expo-sqlite`. Ver ADR-0004 en el vault.
//
// Las pruebas de componentes/pantallas (que si necesitarian jest-expo y el
// transform de RN) quedan fuera del alcance de T-04.
/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/src/datos'],
  testMatch: ['**/*.spec.ts'],
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
