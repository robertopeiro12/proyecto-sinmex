import { randomUUID } from 'expo-crypto';

import { abrirBaseDatos } from './driver-expo';
import { ejecutarMigraciones, migraciones } from './migraciones';
import { relojSistema } from './reloj';
import { crearRepositorioCatalogos, type RepositorioCatalogos } from './repositorios/catalogos';
import { crearRepositorioFolios, type RepositorioFolios } from './repositorios/folios';
import { crearRepositorioJornadas, type RepositorioJornadas } from './repositorios/jornadas';
import { crearRepositorioSync, type RepositorioSync } from './repositorios/sync';
import type { DepsRepositorio } from './repositorios/deps';

/** Lo que la app usa para hablar con la base local. */
export interface CapaDatos {
  deps: DepsRepositorio;
  catalogos: RepositorioCatalogos;
  jornadas: RepositorioJornadas;
  /** Cursor del pull incremental (T-07). */
  sync: RepositorioSync;
  /**
   * Emision offline de folios (T-14).
   *
   * Hoy **nadie lo llama todavia**: la jornada no lleva folio y las entidades
   * que si lo llevaran son T-16 (venta) y T-20 (cobranza). Se arma aqui para
   * que esos tickets solo tengan que emitir dentro de su transaccion.
   */
  folios: RepositorioFolios;
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

  // Ya no hay semilla de desarrollo: los catalogos bajan del `pull` real
  // (T-07), que corre tras el primer login en linea. Ver
  // `sincronizacion/motor.ts` y `estado/proveedor-sesion.tsx`.

  return {
    deps,
    catalogos,
    jornadas: crearRepositorioJornadas(deps),
    sync: crearRepositorioSync(deps),
    folios: crearRepositorioFolios(deps),
    versionEsquema: versionFinal,
  };
}
