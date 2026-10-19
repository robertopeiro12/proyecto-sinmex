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
// Los topes de largo del prospecto NO se reexportan aqui: `LARGO_MAX_COMENTARIOS`
// ya lo exporta `ventas-reglas` (T-16) con otro valor, y dos constantes con el
// mismo nombre en la misma barrera es como se acaba aplicando el tope de la
// venta al prospecto sin que nadie lo note. Quien los necesite (su propia
// prueba) los importa de `repositorios/prospectos`.
export {
  crearRepositorioProspectos,
  ErrorProspecto,
} from './repositorios/prospectos';
export type {
  DatosRegistroProspecto,
  RepositorioProspectos,
} from './repositorios/prospectos';
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
  RegaloRegistroVenta,
  RepositorioVentas,
} from './repositorios/ventas';
export { crearRepositorioPromociones } from './repositorios/promociones';
export type { RepositorioPromociones } from './repositorios/promociones';
export {
  aplicarRegalos,
  calcularRegalos,
  problemasDeRegalos,
  promocionesAplicables,
  textoPromocion,
} from './promociones-reglas';
export type { CatalogoPromociones, PromocionAplicable, Regalo } from './promociones-reglas';
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
export {
  aplicarSnapshotRutas,
  crearRepositorioRutas,
  ErrorRuta,
  restarDias,
} from './repositorios/rutas';
export type {
  ContextoAltaRuta,
  FilaRutaDelDia,
  FilaRutaPull,
  RepositorioRutas,
} from './repositorios/rutas';
export { crearRepositorioCobranzas, ErrorCobranza } from './repositorios/cobranzas';
export type { DatosRegistroCobranza, RepositorioCobranzas } from './repositorios/cobranzas';
export {
  crearRepositorioVisitas,
  ErrorVisita,
  LARGO_MAX_ATENDIO,
  LARGO_MAX_DIRECCION,
  LARGO_MAX_OBSERVACIONES_VISITA,
} from './repositorios/visitas';
export type { DatosRegistroVisita, RepositorioVisitas } from './repositorios/visitas';
export {
  crearRepositorioGastos,
  ErrorGasto,
  LARGO_MAX_COMENTARIO_GASTO,
  MAX_MONTO_GASTO_CENTAVOS,
} from './repositorios/gastos';
export type { DatosRegistroGasto, RepositorioGastos } from './repositorios/gastos';
export {
  leerAbonos,
  leerMontoCentavos,
  MAX_CENTAVOS_COBRO,
  problemasDeCobro,
  repartirPago,
} from './cobranzas-reglas';
export type {
  Aplicacion,
  CapturaCobro,
  NotaParaReparto,
  Reparto,
  TipoAbono,
} from './cobranzas-reglas';
export { ayudaRangoFecha, lineasDelCobro, NOMBRE_METODO } from './cobranzas-textos';
export type { LineaDeCobro } from './cobranzas-textos';
export * from './tipos';
