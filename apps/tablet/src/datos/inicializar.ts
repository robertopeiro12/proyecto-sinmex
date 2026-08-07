import { randomUUID } from 'expo-crypto';

import { abrirBaseDatos } from './driver-expo';
import { ejecutarMigraciones, migraciones } from './migraciones';
import { relojSistema } from './reloj';
import { crearRepositorioCatalogos, type RepositorioCatalogos } from './repositorios/catalogos';
import { crearRepositorioJornadas, type RepositorioJornadas } from './repositorios/jornadas';
import type { DepsRepositorio } from './repositorios/deps';
import { sembrarCatalogosDeDesarrollo } from './semilla-dev';

/** Lo que la app usa para hablar con la base local. */
export interface CapaDatos {
  deps: DepsRepositorio;
  catalogos: RepositorioCatalogos;
  jornadas: RepositorioJornadas;
  /** Version de esquema con la que quedo la base tras migrar. */
  versionEsquema: number;
}

/**
 * Abre la base local, la migra al dia y arma los repositorios.
 *
 * Corre **una sola vez** al arrancar la app (`app/_layout.tsx`). Es sincrono a
 * proposito: la app no puede pintar nada util antes de que exista el esquema, y
 * abrir SQLite local toma milisegundos.
 */
export function inicializarCapaDatos(): CapaDatos {
  const bd = abrirBaseDatos();
  const { versionFinal } = ejecutarMigraciones(bd, migraciones);

  const deps: DepsRepositorio = { bd, reloj: relojSistema, generarId: randomUUID };
  const catalogos = crearRepositorioCatalogos(deps);

  // TODO: T-07 — quitar la semilla cuando el `pull` baje catalogos reales.
  sembrarCatalogosDeDesarrollo(catalogos);

  return {
    deps,
    catalogos,
    jornadas: crearRepositorioJornadas(deps),
    versionEsquema: versionFinal,
  };
}
