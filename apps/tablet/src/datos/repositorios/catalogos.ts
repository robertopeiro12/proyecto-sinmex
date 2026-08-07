import type { BaseDatos, ValorSQL } from '../base-datos';
import type { DepsRepositorio } from './deps';
import { enTransaccion } from './deps';
import type {
  Cliente,
  ClientePrecio,
  FechaISO,
  Presentacion,
  Producto,
  Sucursal,
  Vehiculo,
  Vendedor,
} from '../tipos';

/**
 * Snapshot de catalogos tal como lo entregara el `pull` de T-07.
 * Cada fila llega **sin** `sincronizado_en`: lo pone el repositorio.
 */
export interface SnapshotCatalogos {
  sucursales: Omit<Sucursal, 'sincronizado_en'>[];
  vendedores: Omit<Vendedor, 'sincronizado_en'>[];
  vehiculos: Omit<Vehiculo, 'sincronizado_en'>[];
  productos: Omit<Producto, 'sincronizado_en'>[];
  presentaciones: Omit<Presentacion, 'sincronizado_en'>[];
  clientes: Omit<Cliente, 'sincronizado_en'>[];
  precios: Omit<ClientePrecio, 'sincronizado_en'>[];
}

export type RepositorioCatalogos = ReturnType<typeof crearRepositorioCatalogos>;

/** Columnas de cada catalogo, en el orden en que se escriben. */
const COLUMNAS = {
  sucursal: ['id', 'codigo', 'nombre', 'activa'],
  vendedor: ['id', 'login', 'nombre', 'sucursal_id', 'activo'],
  vehiculo: ['id', 'nombre', 'sucursal_id', 'activo'],
  producto: ['id', 'nombre', 'activo'],
  presentacion: ['id', 'producto_id', 'volumen'],
  cliente: [
    'id',
    'nombre',
    'domicilio',
    'telefono',
    'encargado',
    'tipo',
    'pct_comision',
    'promocion',
    'plazo_credito_dias',
    'lat',
    'lng',
    'sucursal_id',
  ],
  cliente_precio: [
    'id',
    'cliente_id',
    'presentacion_id',
    'precio_centavos',
    'vigente_desde',
  ],
} as const;

/**
 * Lectura de los catalogos precargados y escritura del snapshot que baja del
 * portal.
 *
 * Los catalogos son **de solo lectura para el vendedor**: el alta de clientes
 * ya no la hace el en la app (ver [[App Tablet]], seccion Prospectos). La unica
 * escritura es aplicar el snapshot que manda el portal.
 */
export function crearRepositorioCatalogos({ bd, reloj }: DepsRepositorio) {
  return {
    /**
     * Aplica el snapshot de catalogos recibido del portal.
     *
     * **Es un upsert, no un reemplazo.** La primera version de este metodo
     * borraba cada tabla antes de insertar, y una prueba lo tumbo: si el
     * vendedor ya abrio el dia, su `jornada` apunta a un vehiculo, un vendedor
     * y una sucursal, y borrarlos revienta la llave foranea. El refresco de
     * catalogos de media manana (11:00/14:00, ver [[Sincronizacion offline]])
     * ocurre justo cuando hay una jornada abierta, asi que ese caso es la norma
     * y no la excepcion.
     *
     * Consecuencia conocida: una fila que **desaparece** del snapshot (un
     * cliente dado de baja en el portal) se queda en la tablet hasta que se
     * defina la purga.
     *
     * TODO: T-07 — decidir la politica de purga. Lo natural, dado que el portal
     *       nunca borra fisico (`deleted_at`), es que el snapshot traiga la
     *       bandera de baja y aqui solo se refleje; no borrar filas que la
     *       operacion local todavia referencia.
     *
     * Todo va en una sola transaccion: la tablet nunca queda con medio catalogo
     * si la bajada se corta a la mitad.
     */
    guardarSnapshot(snapshot: SnapshotCatalogos): void {
      const ahora = reloj.ahora();

      enTransaccion(bd, () => {
        // Orden de llaves foraneas: sucursal -> vendedor/vehiculo/cliente,
        // producto -> presentacion -> cliente_precio.
        upsert(bd, 'sucursal', COLUMNAS.sucursal, snapshot.sucursales, ahora);
        upsert(bd, 'vendedor', COLUMNAS.vendedor, snapshot.vendedores, ahora);
        upsert(bd, 'vehiculo', COLUMNAS.vehiculo, snapshot.vehiculos, ahora);
        upsert(bd, 'producto', COLUMNAS.producto, snapshot.productos, ahora);
        upsert(bd, 'presentacion', COLUMNAS.presentacion, snapshot.presentaciones, ahora);
        upsert(bd, 'cliente', COLUMNAS.cliente, snapshot.clientes, ahora);
        upsert(bd, 'cliente_precio', COLUMNAS.cliente_precio, snapshot.precios, ahora);
      });
    },

    /** Vehiculos activos de una sucursal, para la pantalla de abrir el dia. */
    listarVehiculos(sucursalId: string): Vehiculo[] {
      return bd.getAllSync<Vehiculo>(
        `select * from vehiculo
         where sucursal_id = $sucursal_id and activo = 1
         order by nombre`,
        { $sucursal_id: sucursalId },
      );
    },

    /** Clientes (no prospectos) de una sucursal. */
    listarClientes(sucursalId: string): Cliente[] {
      return bd.getAllSync<Cliente>(
        `select * from cliente
         where sucursal_id = $sucursal_id and tipo = 'cliente'
         order by nombre`,
        { $sucursal_id: sucursalId },
      );
    },

    obtenerCliente(id: string): Cliente | null {
      return bd.getFirstSync<Cliente>('select * from cliente where id = $id', { $id: id });
    },

    obtenerVendedorPorLogin(login: string): Vendedor | null {
      return bd.getFirstSync<Vendedor>('select * from vendedor where login = $login', {
        $login: login,
      });
    },

    /**
     * Precio en centavos que aplica a un cliente para una presentacion en una
     * fecha. Toma el registro vigente mas reciente que no sea futuro, que es
     * como el portal historiza los precios (ver [[Lista de precios]]).
     */
    precioVigente(clienteId: string, presentacionId: string, fecha: FechaISO): number | null {
      const fila = bd.getFirstSync<{ precio_centavos: number }>(
        `select precio_centavos from cliente_precio
         where cliente_id = $cliente_id
           and presentacion_id = $presentacion_id
           and vigente_desde <= $fecha
         order by vigente_desde desc
         limit 1`,
        { $cliente_id: clienteId, $presentacion_id: presentacionId, $fecha: fecha },
      );
      return fila?.precio_centavos ?? null;
    },

    /**
     * Cuando se bajo el snapshot mas viejo que hay en la base, o `null` si aun
     * no hay catalogos. Sirve para advertir que los datos precargados estan
     * viejos (ver "Datos precargados (frescura)" en [[Sincronizacion offline]]).
     */
    frescuraCatalogos(): string | null {
      const fila = bd.getFirstSync<{ mas_viejo: string | null }>(
        `select min(sincronizado_en) as mas_viejo from (
           select sincronizado_en from sucursal
           union all select sincronizado_en from vehiculo
           union all select sincronizado_en from cliente
           union all select sincronizado_en from cliente_precio
         )`,
      );
      return fila?.mas_viejo ?? null;
    },
  };
}

/**
 * `insert ... on conflict(id) do update`, generico sobre la lista de columnas.
 *
 * El nombre de tabla y las columnas se interpolan en el SQL, pero salen de la
 * constante `COLUMNAS` de este archivo — nunca de datos externos. Los **valores**
 * si van enlazados como parametros.
 */
function upsert(
  bd: BaseDatos,
  tabla: string,
  columnas: readonly string[],
  filas: readonly Record<string, unknown>[],
  sincronizadoEn: string,
): void {
  if (filas.length === 0) return;

  const todas = [...columnas, 'sincronizado_en'];
  const marcadores = todas.map((c) => `$${c}`).join(', ');
  const asignaciones = todas
    .filter((c) => c !== 'id')
    .map((c) => `${c} = excluded.${c}`)
    .join(', ');

  const sql =
    `insert into ${tabla} (${todas.join(', ')}) values (${marcadores}) ` +
    `on conflict(id) do update set ${asignaciones}`;

  for (const fila of filas) {
    const params: Record<string, ValorSQL> = { $sincronizado_en: sincronizadoEn };
    for (const columna of columnas) {
      params[`$${columna}`] = (fila[columna] ?? null) as ValorSQL;
    }
    bd.runSync(sql, params);
  }
}
