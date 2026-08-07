import type { RepositorioCatalogos, SnapshotCatalogos } from './repositorios/catalogos';

/**
 * Catalogos de mentira para poder navegar el shell en un dispositivo antes de
 * que exista la sincronizacion.
 *
 * TODO: T-07 — al implementar el `pull` matutino, borrar este archivo y su
 *       llamada en `inicializar.ts`. Los catalogos reales bajan del portal.
 */
const SEMILLA: SnapshotCatalogos = {
  sucursales: [
    { id: 'dev-suc-tj', codigo: 'TJ', nombre: 'Tijuana', activa: 1 },
    { id: 'dev-suc-mx', codigo: 'MX', nombre: 'Mexicali', activa: 1 },
  ],
  vendedores: [
    {
      id: 'dev-ven-1',
      login: 'demo',
      nombre: 'Vendedor de prueba',
      sucursal_id: 'dev-suc-tj',
      activo: 1,
    },
  ],
  vehiculos: [
    { id: 'dev-veh-1', nombre: 'Camioneta 01', sucursal_id: 'dev-suc-tj', activo: 1 },
    { id: 'dev-veh-2', nombre: 'Camioneta 02', sucursal_id: 'dev-suc-tj', activo: 1 },
  ],
  productos: [
    { id: 'dev-pro-1', nombre: 'Jamaica', activo: 1 },
    { id: 'dev-pro-2', nombre: 'Horchata', activo: 1 },
    { id: 'dev-pro-3', nombre: 'Te de Jazmin', activo: 1 },
  ],
  presentaciones: [
    { id: 'dev-pre-1', producto_id: 'dev-pro-1', volumen: '1 L' },
    { id: 'dev-pre-2', producto_id: 'dev-pro-2', volumen: '1 L' },
    { id: 'dev-pre-3', producto_id: 'dev-pro-3', volumen: '500 ml' },
  ],
  clientes: [
    {
      id: 'dev-cli-1',
      nombre: 'Abarrotes La Esquina',
      domicilio: 'Calle 5 #12, Col. Centro',
      telefono: '6641234567',
      encargado: 'Lupita',
      tipo: 'cliente',
      pct_comision: 3.5,
      promocion: '10+1',
      plazo_credito_dias: 7,
      lat: 32.5149,
      lng: -117.0382,
      sucursal_id: 'dev-suc-tj',
    },
    {
      id: 'dev-cli-2',
      nombre: 'Loncheria Dona Mari',
      domicilio: 'Av. Revolucion 88',
      telefono: '6647654321',
      encargado: 'Mari',
      tipo: 'cliente',
      pct_comision: 4,
      promocion: 'ninguna',
      plazo_credito_dias: null,
      lat: 32.5325,
      lng: -117.0442,
      sucursal_id: 'dev-suc-tj',
    },
    {
      id: 'dev-cli-3',
      nombre: 'Miscelanea El Sol',
      domicilio: 'Blvd. Diaz Ordaz 1500',
      telefono: '6642223344',
      encargado: null,
      tipo: 'cliente',
      pct_comision: null,
      promocion: '20+1',
      plazo_credito_dias: 15,
      lat: 32.5011,
      lng: -116.9998,
      sucursal_id: 'dev-suc-tj',
    },
  ],
  precios: [
    {
      id: 'dev-pcl-1',
      cliente_id: 'dev-cli-1',
      presentacion_id: 'dev-pre-1',
      precio_centavos: 2800,
      vigente_desde: '2026-01-01',
    },
    {
      id: 'dev-pcl-2',
      cliente_id: 'dev-cli-2',
      presentacion_id: 'dev-pre-1',
      precio_centavos: 3000,
      vigente_desde: '2026-01-01',
    },
  ],
};

/** Sucursal del vendedor de prueba, mientras no haya login (T-06). */
export const SUCURSAL_DEV = 'dev-suc-tj';

/** Siembra los catalogos si la base aun no tiene ninguno. */
export function sembrarCatalogosDeDesarrollo(catalogos: RepositorioCatalogos): void {
  if (catalogos.frescuraCatalogos() !== null) return;
  catalogos.guardarSnapshot(SEMILLA);
}
