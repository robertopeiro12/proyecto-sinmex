import { randomUUID } from 'expo-crypto';

import { abrirBaseDatos } from './driver-expo';
import { ejecutarMigraciones, migraciones } from './migraciones';
import { relojSistema } from './reloj';
import { crearRepositorioCatalogos, type RepositorioCatalogos } from './repositorios/catalogos';
import { crearRepositorioFolios, type RepositorioFolios } from './repositorios/folios';
import { crearRepositorioJornadas, type RepositorioJornadas } from './repositorios/jornadas';
import {
  crearRepositorioProspectos,
  type RepositorioProspectos,
} from './repositorios/prospectos';
import { crearRepositorioSync, type RepositorioSync } from './repositorios/sync';
import { crearRepositorioVentas, type RepositorioVentas } from './repositorios/ventas';
import type { DepsRepositorio } from './repositorios/deps';

/** Lo que la app usa para hablar con la base local. */
export interface CapaDatos {
  deps: DepsRepositorio;
  catalogos: RepositorioCatalogos;
  jornadas: RepositorioJornadas;
  /** Cursor del pull incremental (T-07). */
  sync: RepositorioSync;
  /**
   * Emision offline de folios (T-14). La usa `ventas` dentro de su propia
   * transaccion (T-16); T-20 hara lo mismo con la cobranza.
   */
  folios: RepositorioFolios;
  /** Ventas capturadas en ruta (T-16). */
  ventas: RepositorioVentas;
  /** Prospectos capturados en ruta (T-40). */
  prospectos: RepositorioProspectos;
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
  // Una sola instancia: la que expone la capa de datos es la misma con la que
  // las ventas emiten sus folios.
  const folios = crearRepositorioFolios(deps);

  // Ya no hay semilla de desarrollo: los catalogos bajan del `pull` real
  // (T-07), que corre tras el primer login en linea. Ver
  // `sincronizacion/motor.ts` y `estado/proveedor-sesion.tsx`.

  return {
    deps,
    catalogos,
    jornadas: crearRepositorioJornadas(deps),
    sync: crearRepositorioSync(deps),
    folios,
    ventas: crearRepositorioVentas(deps, { catalogos, folios }),
    // Recibe el MISMO `catalogos` que expone la capa de datos: es quien publica
    // la version que observan las pantallas y quien sabe si el tipo de negocio
    // elegido sigue vivo en el catalogo local.
    prospectos: crearRepositorioProspectos(deps, { catalogos }),
    versionEsquema: versionFinal,
  };
}
