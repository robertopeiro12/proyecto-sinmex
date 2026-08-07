/**
 * Punto de entrada de la capa de datos local.
 *
 * OJO: aqui NO se exporta `driver-node.ts` ni `pruebas-apoyo.ts` a proposito —
 * arrastrarian `better-sqlite3`, que es un modulo nativo de Node y Metro no
 * puede empaquetar.
 */
export type { BaseDatos, ParametrosSQL, ResultadoEscritura, ValorSQL } from './base-datos';
export { abrirBaseDatos, adaptarExpoSQLite, NOMBRE_BD } from './driver-expo';
export { ejecutarMigraciones, migraciones, versionEsquema } from './migraciones';
export type { Migracion, ResultadoMigraciones } from './migraciones';
export { relojSistema, relojFijo } from './reloj';
export type { Reloj } from './reloj';
export { enTransaccion } from './repositorios/deps';
export type { DepsRepositorio } from './repositorios/deps';
export { crearRepositorioCatalogos } from './repositorios/catalogos';
export type { RepositorioCatalogos, SnapshotCatalogos } from './repositorios/catalogos';
export { crearRepositorioJornadas, ErrorJornada } from './repositorios/jornadas';
export type { DatosAperturaJornada, RepositorioJornadas } from './repositorios/jornadas';
export * from './tipos';
