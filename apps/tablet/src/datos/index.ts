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
export type {
  PresentacionParaVenta,
  RepositorioCatalogos,
  SnapshotCatalogos,
} from './repositorios/catalogos';
export { crearRepositorioJornadas, ErrorJornada } from './repositorios/jornadas';
export type { DatosAperturaJornada, RepositorioJornadas } from './repositorios/jornadas';
export { crearRepositorioSync, CURSOR_PULL } from './repositorios/sync';
export type { RepositorioSync } from './repositorios/sync';
export {
  crearRepositorioFolios,
  ErrorFolio,
  formarFolio,
  MAX_OPERACIONES_POR_DIA,
} from './repositorios/folios';
export type {
  FolioEmitido,
  PeticionFolio,
  RepositorioFolios,
} from './repositorios/folios';
export { crearRepositorioVentas, ErrorVenta } from './repositorios/ventas';
export type {
  DatosRegistroVenta,
  LineaRegistroVenta,
  RepositorioVentas,
} from './repositorios/ventas';
export {
  LARGO_MAX_COMENTARIOS,
  LARGO_MAX_NUM_NOTA,
  leerCantidad,
  MAX_LINEAS_VENTA,
  problemasDeCaptura,
  resumirCaptura,
} from './ventas-reglas';
export type {
  CapturaVenta,
  LineaCaptura,
  ResumenCaptura,
  ResumenLinea,
} from './ventas-reglas';
export * from './tipos';
