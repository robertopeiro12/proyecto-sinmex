import type { RepositorioCatalogos, SnapshotCatalogos } from './repositorios/catalogos';

/**
 * Catalogos de mentira para poder navegar el shell en un dispositivo antes de
 * que exista la sincronizacion.
 *
 * > [!info] T-06 quito de aqui al vendedor
 * > Esta semilla traia un vendedor `demo` y el arranque de la app lo tomaba
 * > como si tuviera sesion iniciada. Ya no: el vendedor y su sucursal salen del
 * > **login real** (ver `estado/proveedor-sesion.tsx`), y lo que queda aqui son
 * > solo los catalogos que aun no baja nadie. Por eso ahora la semilla recibe
 * > la sucursal del vendedor que entro: sus vehiculos y clientes tienen que
 * > colgar de la sucursal de verdad, no de una inventada.
 *
 * TODO: T-07 — al implementar el `pull` matutino, borrar este archivo y su
 *       llamada en `estado/proveedor-sesion.tsx`. Los catalogos reales bajan
 *       del portal.
 */
function semilla(sucursalId: string): SnapshotCatalogos {
  return {
  // La sucursal ya la inserto el login (con su id y codigo reales); aqui no se
  // vuelve a tocar para no pisar su nombre con uno inventado.
  sucursales: [],
  // Sin vendedores: el unico que existe es el que inicio sesion.
  vendedores: [],
  vehiculos: [
    { id: 'dev-veh-1', nombre: 'Camioneta 01', sucursal_id: sucursalId, activo: 1 },
    { id: 'dev-veh-2', nombre: 'Camioneta 02', sucursal_id: sucursalId, activo: 1 },
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
      sucursal_id: sucursalId,
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
      sucursal_id: sucursalId,
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
      sucursal_id: sucursalId,
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
}

/**
 * Siembra los catalogos de desarrollo bajo la sucursal del vendedor que acaba
 * de entrar, si la base aun no tiene vehiculos suyos.
 *
 * La condicion mira los **vehiculos de esa sucursal** y no la frescura global
 * de los catalogos: desde T-06 el login ya escribe la sucursal y el vendedor,
 * asi que la base nunca esta vacia cuando esto corre y la comprobacion anterior
 * (`frescuraCatalogos() !== null`) impediria sembrar siempre.
 */
export function sembrarCatalogosDeDesarrollo(
  catalogos: RepositorioCatalogos,
  sucursalId: string,
): void {
  if (catalogos.listarVehiculos(sucursalId).length > 0) return;
  catalogos.guardarSnapshot(semilla(sucursalId));
}
