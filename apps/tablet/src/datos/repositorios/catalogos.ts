import type { BaseDatos, ValorSQL } from '../base-datos';
import type { DepsRepositorio } from './deps';
import { enTransaccion } from './deps';
import type {
  Cliente,
  ClientePrecio,
  FechaISO,
  NotaPendiente,
  Presentacion,
  Producto,
  Sucursal,
  Vehiculo,
  Vendedor,
} from '../tipos';

/**
 * Snapshot de catalogos tal como lo entrega el `pull` de T-07.
 * Cada fila llega **sin** `sincronizado_en`: lo pone el repositorio.
 *
 * Todas las colecciones son opcionales porque el pull es **incremental**: una
 * sincronizacion de media manana suele traer solo lo que cambio, y a veces
 * nada. Obligar a mandar listas vacias haria que quien llame se equivocara al
 * primer descuido.
 */
export interface SnapshotCatalogos {
  sucursales?: Omit<Sucursal, 'sincronizado_en'>[];
  vendedores?: Omit<Vendedor, 'sincronizado_en'>[];
  vehiculos?: Omit<Vehiculo, 'sincronizado_en'>[];
  productos?: Omit<Producto, 'sincronizado_en'>[];
  presentaciones?: Omit<Presentacion, 'sincronizado_en'>[];
  clientes?: Omit<Cliente, 'sincronizado_en'>[];
  precios?: Omit<ClientePrecio, 'sincronizado_en'>[];
  notas?: Omit<NotaPendiente, 'sincronizado_en'>[];
}

export type RepositorioCatalogos = ReturnType<typeof crearRepositorioCatalogos>;

/** Columnas de cada catalogo, en el orden en que se escriben. */
const COLUMNAS = {
  sucursal: ['id', 'codigo', 'nombre', 'activa'],
  vendedor: [
    'id',
    'login',
    'nombre',
    'sucursal_id',
    'activo',
    // T-14: lo asigna el servidor; la tablet lo refleja y lo usa al foliar.
    'folio_segmento',
  ],
  vehiculo: ['id', 'nombre', 'sucursal_id', 'activo'],
  producto: ['id', 'nombre', 'activo'],
  presentacion: ['id', 'producto_id', 'volumen', 'activo'],
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
    'activo',
  ],
  cliente_precio: [
    'id',
    'cliente_id',
    'presentacion_id',
    'precio_centavos',
    'vigente_desde',
    'activo',
  ],
  nota_pendiente: [
    'id',
    'cliente_id',
    'folio',
    'num_nota',
    'fecha',
    'status',
    'monto_total_centavos',
    'saldo_centavos',
    'activo',
  ],
} as const;

/**
 * Columnas que **no se pisan con `null`** al aplicar un snapshot.
 *
 * El upsert normal hace `columna = excluded.columna`, que es lo correcto para un
 * catalogo: el portal manda y lo que llega gana. Pero no todos los snapshots
 * vienen del `pull`.
 *
 * El caso concreto: un login **sin red** (re-autenticacion local, ADR-0005) hace
 * un upsert de identidad con lo unico que la sesion guardada conoce — id, login,
 * nombre y sucursal. **No conoce el `folio_segmento`**, porque ese lo asigna el
 * servidor. Si ese upsert lo pisara con `null`, el vendedor se quedaria sin
 * poder emitir [[Folios|folios]] hasta el siguiente `pull`... que un login
 * offline **nunca dispara**. Se quedaria sin operar en plena ruta.
 *
 * Asi que para estas columnas el upsert usa `coalesce(excluded.x, tabla.x)`: un
 * valor de verdad gana (el `pull` sigue mandando), pero un `null` no borra lo
 * que ya habia. Es la misma doctrina de ADR-0007: el segmento **se pina**, no se
 * recalcula ni se pierde por el camino.
 */
const NO_BORRAR_CON_NULO: Record<string, readonly string[]> = {
  vendedor: ['folio_segmento'],
};

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
     * ### La purga: la baja llega como bandera (T-07)
     *
     * Una fila que **desaparece** del snapshot se queda aqui — con upsert no
     * puede ser de otra forma. Por eso el `pull` nunca omite lo dado de baja:
     * lo manda con `activo: 0`. El portal no borra fisico (`deleted_at`), asi
     * que una baja es un `update` y viaja por el mismo cursor incremental que
     * cualquier otro cambio. Aqui solo se refleja; las consultas filtran por
     * `activo = 1` y la operacion local que ya referenciaba esa fila sigue
     * intacta.
     *
     * Todo va en una sola transaccion: la tablet nunca queda con medio catalogo
     * si la bajada se corta a la mitad.
     */
    guardarSnapshot(snapshot: SnapshotCatalogos): void {
      const ahora = reloj.ahora();

      enTransaccion(bd, () => {
        // Orden de llaves foraneas: sucursal -> vendedor/vehiculo/cliente,
        // producto -> presentacion -> cliente_precio -> nota_pendiente.
        upsert(bd, 'sucursal', COLUMNAS.sucursal, snapshot.sucursales, ahora);
        upsert(bd, 'vendedor', COLUMNAS.vendedor, snapshot.vendedores, ahora);
        upsert(bd, 'vehiculo', COLUMNAS.vehiculo, snapshot.vehiculos, ahora);
        upsert(bd, 'producto', COLUMNAS.producto, snapshot.productos, ahora);
        upsert(bd, 'presentacion', COLUMNAS.presentacion, snapshot.presentaciones, ahora);
        upsert(bd, 'cliente', COLUMNAS.cliente, snapshot.clientes, ahora);
        upsert(bd, 'cliente_precio', COLUMNAS.cliente_precio, snapshot.precios, ahora);
        upsert(bd, 'nota_pendiente', COLUMNAS.nota_pendiente, snapshot.notas, ahora);
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

    /** Clientes (no prospectos) **activos** de una sucursal. */
    listarClientes(sucursalId: string): Cliente[] {
      return bd.getAllSync<Cliente>(
        `select * from cliente
         where sucursal_id = $sucursal_id and tipo = 'cliente' and activo = 1
         order by nombre`,
        { $sucursal_id: sucursalId },
      );
    },

    /**
     * Notas por cobrar de un cliente, para la pantalla de cobranza/abono.
     *
     * Solo las activas: una nota que el portal cancelo mientras el vendedor
     * estaba en ruta no se le debe poder cobrar.
     */
    notasPendientesDe(clienteId: string): NotaPendiente[] {
      return bd.getAllSync<NotaPendiente>(
        `select * from nota_pendiente
         where cliente_id = $cliente_id and activo = 1
         order by fecha`,
        { $cliente_id: clienteId },
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
           and activo = 1
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
  filas: readonly Record<string, unknown>[] | undefined,
  sincronizadoEn: string,
): void {
  if (!filas || filas.length === 0) return;

  const todas = [...columnas, 'sincronizado_en'];
  const marcadores = todas.map((c) => `$${c}`).join(', ');
  const conservar = NO_BORRAR_CON_NULO[tabla] ?? [];
  const asignaciones = todas
    .filter((c) => c !== 'id')
    .map((c) =>
      conservar.includes(c)
        ? // Un valor de verdad gana; un null no borra lo que ya habia.
          `${c} = coalesce(excluded.${c}, ${tabla}.${c})`
        : `${c} = excluded.${c}`,
    )
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
