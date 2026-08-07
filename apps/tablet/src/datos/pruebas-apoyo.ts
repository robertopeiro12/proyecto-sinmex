/**
 * Utilidades **solo para pruebas** de la capa de datos.
 * No se importa desde codigo de la app (arrastraria `better-sqlite3`).
 */
import { abrirBaseDatosNode } from './driver-node';
import { ejecutarMigraciones, migraciones } from './migraciones';
import { relojFijo } from './reloj';
import type { DepsRepositorio } from './repositorios/deps';
import type { SnapshotCatalogos } from './repositorios/catalogos';

/** Momento fijo por defecto de las pruebas (hora de Tijuana, UTC-7). */
export const MOMENTO = '2026-08-07T15:00:00.000Z';

/** Base en memoria, migrada al dia, con reloj y generador de ids deterministas. */
export function depsDePrueba(momento: string = MOMENTO): DepsRepositorio {
  const bd = abrirBaseDatosNode();
  ejecutarMigraciones(bd, migraciones);

  let contador = 0;
  return {
    bd,
    reloj: relojFijo(momento),
    generarId: () => `id-${++contador}`,
  };
}

/** Snapshot minimo pero coherente: 1 sucursal, 1 vendedor, 1 vehiculo, 2 clientes. */
export function snapshotDePrueba(): SnapshotCatalogos {
  return {
    sucursales: [{ id: 'suc-tj', codigo: 'TJ', nombre: 'Tijuana', activa: 1 }],
    vendedores: [
      { id: 'ven-1', login: 'aperez', nombre: 'Abraham Perez', sucursal_id: 'suc-tj', activo: 1 },
      { id: 'ven-2', login: 'bruiz', nombre: 'Berta Ruiz', sucursal_id: 'suc-tj', activo: 0 },
    ],
    vehiculos: [
      { id: 'veh-1', nombre: 'Camioneta 01', sucursal_id: 'suc-tj', activo: 1 },
      { id: 'veh-2', nombre: 'Camioneta 02 (baja)', sucursal_id: 'suc-tj', activo: 0 },
    ],
    productos: [{ id: 'pro-1', nombre: 'Jamaica', activo: 1 }],
    presentaciones: [
      { id: 'pre-1', producto_id: 'pro-1', volumen: '1 L' },
      { id: 'pre-2', producto_id: 'pro-1', volumen: '500 ml' },
    ],
    clientes: [
      {
        id: 'cli-1',
        nombre: 'Abarrotes La Esquina',
        domicilio: 'Calle 5 #12',
        telefono: '6641234567',
        encargado: 'Lupita',
        tipo: 'cliente',
        pct_comision: 3.5,
        promocion: '10+1',
        plazo_credito_dias: 7,
        lat: 32.5149,
        lng: -117.0382,
        sucursal_id: 'suc-tj',
      },
      {
        id: 'cli-2',
        nombre: 'Tienda Nueva (prospecto)',
        domicilio: 'Av. Reforma 9',
        telefono: '6647654321',
        encargado: null,
        tipo: 'prospecto',
        pct_comision: null,
        promocion: 'ninguna',
        plazo_credito_dias: null,
        lat: null,
        lng: null,
        sucursal_id: 'suc-tj',
      },
    ],
    precios: [
      {
        id: 'pcl-1',
        cliente_id: 'cli-1',
        presentacion_id: 'pre-1',
        precio_centavos: 2500,
        vigente_desde: '2026-01-01',
      },
      {
        id: 'pcl-2',
        cliente_id: 'cli-1',
        presentacion_id: 'pre-1',
        precio_centavos: 2800,
        vigente_desde: '2026-08-01',
      },
      {
        id: 'pcl-3',
        cliente_id: 'cli-1',
        presentacion_id: 'pre-1',
        precio_centavos: 3000,
        vigente_desde: '2026-12-01',
      },
    ],
  };
}
