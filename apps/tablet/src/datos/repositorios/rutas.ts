import type { BaseDatos } from '../base-datos';
import type {
  Booleano,
  FechaISO,
  MomentoISO,
  OrigenRuta,
  Ruta,
  SyncEstadoRuta,
} from '../tipos';
import type { RepositorioCatalogos } from './catalogos';
import type { DepsRepositorio } from './deps';
import { enTransaccion } from './deps';
import { exigirJornadaAbierta } from './jornadas';

/** Error de regla de negocio de la ruta (no un fallo tecnico de SQLite). */
export class ErrorRuta extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'ErrorRuta';
  }
}

/**
 * Una fila de ruta como la manda el pull (`RutaPull` del contrato). Estructural
 * a proposito: la capa de datos no importa el contrato, y `aSnapshot` le pasa
 * las filas del pull tal cual.
 */
export type FilaRutaPull = Pick<Ruta, 'id' | 'cliente_id' | 'fecha' | 'orden' | 'origen' | 'activo'>;

/** Una fila de la ruta del dia como la pinta la pantalla principal (D16). */
export interface FilaRutaDelDia {
  id: string;
  cliente_id: string;
  fecha: FechaISO;
  orden: number;
  origen: OrigenRuta;
  activo: Booleano;
  sync_estado: SyncEstadoRuta;
  sync_error: string | null;
  nombre: string;
  domicilio: string | null;
  /** La que puso el dedo del vendedor, o `null` si no ha reordenado a este cliente. */
  posicion: number | null;
  /** Notas con saldo del cliente: la burbuja. Baja al cobrar sin red. */
  notas_pendientes: number;
  /** Hoy tiene venta o cobro en esta tablet (D5). Se deriva, no se guarda. */
  visitado: boolean;
}

/** Quien agrega: el vendedor con sesion y su sucursal. */
export interface ContextoAltaRuta {
  vendedorId: string;
  sucursalId: string;
}

/** `AAAA-MM-DD` menos `dias`. `Date.UTC` solo para la aritmetica del calendario. */
export function restarDias(fecha: FechaISO, dias: number): FechaISO {
  const [anio = 0, mes = 1, dia = 1] = fecha.split('-').map(Number);
  return new Date(Date.UTC(anio, mes - 1, dia - dias)).toISOString().slice(0, 10);
}

/**
 * Aplica la ruta que baja en el pull, con la **regla de fusion** del spec (D15).
 * Sin transaccion propia: la llama `catalogos.guardarSnapshot` dentro de la suya,
 * despues de `cliente` (una fila de ruta puede traer a un cliente que llego en
 * el mismo snapshot).
 *
 * Por cada fila:
 *
 * 1. **Si su cliente no esta en la tablet, se omite.** La llave foranea a
 *    `cliente` revertiria el pull ENTERO y el vendedor se quedaria sin refrescar
 *    nada; la fila vuelve a bajar cuando el cliente llegue (Review Focus 1).
 * 2. **Si viene viva, antes se borra cualquier fila del mismo `(fecha,
 *    cliente)` con otro id**: un alta local (se funde: queda la del servidor; si
 *    la operacion seguia pendiente, el servidor la respondera `ruta-duplicada`,
 *    que la tablet trata como aplicada) o una baja vieja (la oficina quito y
 *    volvio a poner al cliente: en el servidor es otra fila). Sin este paso la
 *    fila viva nueva chocaria con `uq_ruta_fecha_cliente`.
 * 3. Upsert por `id`. Nunca toca `sync_estado` ni `clave`, ni `ruta_orden_local`:
 *    la posicion va por `(fecha, cliente)` y sobrevive a la fusion.
 *
 * Una fila con `activo: 0` se queda con la bandera; la pantalla decide (D16).
 *
 * @returns cuantas filas escribio (para que `guardarSnapshot` sepa si avisar).
 */
export function aplicarSnapshotRutas(
  bd: BaseDatos,
  filas: readonly FilaRutaPull[] | undefined,
  sincronizadoEn: MomentoISO,
): number {
  if (!filas || filas.length === 0) return 0;
  let escritas = 0;

  for (const fila of filas) {
    const cliente = bd.getFirstSync<{ id: string }>('select id from cliente where id = $id', {
      $id: fila.cliente_id,
    });
    if (!cliente) continue;

    if (fila.activo === 1) {
      bd.runSync(
        `delete from ruta
          where fecha = $fecha and cliente_id = $cliente_id and id <> $id`,
        { $fecha: fila.fecha, $cliente_id: fila.cliente_id, $id: fila.id },
      );
    }

    bd.runSync(
      `insert into ruta (id, cliente_id, fecha, orden, origen, activo, sync_estado, sincronizado_en)
       values ($id, $cliente_id, $fecha, $orden, $origen, $activo, 'sincronizada', $sincronizado_en)
       on conflict(id) do update set
         cliente_id = excluded.cliente_id,
         fecha = excluded.fecha,
         orden = excluded.orden,
         origen = excluded.origen,
         activo = excluded.activo,
         sincronizado_en = excluded.sincronizado_en`,
      {
        $id: fila.id,
        $cliente_id: fila.cliente_id,
        $fecha: fila.fecha,
        $orden: fila.orden,
        $origen: fila.origen,
        $activo: fila.activo,
        $sincronizado_en: sincronizadoEn,
      },
    );
    escritas += 1;
  }

  return escritas;
}

export type RepositorioRutas = ReturnType<typeof crearRepositorioRutas>;

/**
 * La ruta del dia en la tablet (T-37, D15): lo que baja del portal, lo que el
 * vendedor agrega y el orden en que la recorre.
 *
 * Recibe `catalogos` para leer el cliente y para **publicar el cambio**: la
 * pantalla principal escucha `versionCatalogos`, y SQLite no avisa a nadie.
 */
export function crearRepositorioRutas(
  { bd, reloj, generarId }: DepsRepositorio,
  { catalogos }: { catalogos: RepositorioCatalogos },
) {
  const repo = {
    /**
     * La ruta de un dia, en el orden del vendedor: primero su posicion local y,
     * sin ella, el orden del servidor (al final). Trae tambien las filas que la
     * oficina quito (`activo = 0`): `agruparRuta` decide si se ven.
     *
     * `visitado` es el mismo predicado que `ventas.delDia(cliente).length > 0 ||
     * cobranzas.delDia(cliente).length > 0` (D5), en la misma consulta. La
     * burbuja es la misma consulta que `catalogos.notasPendientesDe` mas
     * `saldo_centavos > 0`.
     */
    delDia(fecha: FechaISO = reloj.hoy()): FilaRutaDelDia[] {
      const filas = bd.getAllSync<Omit<FilaRutaDelDia, 'visitado'> & { visitado: number }>(
        `select r.id, r.cliente_id, r.fecha, r.orden, r.origen, r.activo,
                r.sync_estado, r.sync_error,
                c.nombre, c.domicilio,
                o.posicion,
                (select count(*) from nota_pendiente n
                  where n.cliente_id = r.cliente_id
                    and n.activo = 1 and n.saldo_centavos > 0) as notas_pendientes,
                (exists (select 1 from venta v
                          where v.cliente_id = r.cliente_id and v.fecha = r.fecha)
                 or exists (select 1 from cobranza k
                             where k.cliente_id = r.cliente_id and k.fecha = r.fecha)) as visitado
           from ruta r
           join cliente c on c.id = r.cliente_id
           left join ruta_orden_local o
                  on o.fecha = r.fecha and o.cliente_id = r.cliente_id
          where r.fecha = $fecha
          order by coalesce(o.posicion, 1000000000 + r.orden), r.orden, c.nombre`,
        { $fecha: fecha },
      );
      return filas.map((f) => ({ ...f, visitado: f.visitado === 1 }));
    },

    /**
     * El vendedor agrega a mano un cliente existente a su ruta (D2, D7). Nace
     * `pendiente`: sube como `ruta-alta` en la siguiente sincronizacion.
     *
     * @throws {ErrorJornada} con el dia cerrado (T-38): primero el candado.
     * @throws {ErrorRuta} si el cliente no se puede agregar.
     */
    agregar(
      clienteId: string,
      { vendedorId, sucursalId }: ContextoAltaRuta,
      fecha: FechaISO = reloj.hoy(),
    ): Ruta {
      exigirJornadaAbierta({ bd, reloj }, vendedorId);

      const cliente = catalogos.obtenerCliente(clienteId);
      if (!cliente || cliente.activo !== 1 || cliente.sucursal_id !== sucursalId) {
        throw new ErrorRuta(
          'Ese cliente ya no está en el catálogo de la tablet. Sincroniza y vuelve a intentarlo.',
        );
      }
      if (cliente.tipo !== 'cliente') {
        throw new ErrorRuta(
          'A un prospecto no se le agrega a la ruta: primero la oficina lo convierte en cliente.',
        );
      }
      const yaEsta = bd.getFirstSync<{ id: string }>(
        'select id from ruta where fecha = $fecha and cliente_id = $cliente_id and activo = 1',
        { $fecha: fecha, $cliente_id: clienteId },
      );
      if (yaEsta) throw new ErrorRuta('Ese cliente ya está en la ruta de hoy.');

      const id = generarId();
      enTransaccion(bd, () => {
        const siguiente = bd.getFirstSync<{ siguiente: number }>(
          'select coalesce(max(orden), 0) + 1 as siguiente from ruta where fecha = $fecha and activo = 1',
          { $fecha: fecha },
        );
        bd.runSync(
          `insert into ruta (id, cliente_id, fecha, orden, origen, activo, sync_estado, clave, sincronizado_en)
           values ($id, $cliente_id, $fecha, $orden, 'vendedor', 1, 'pendiente', $clave, $ahora)`,
          {
            $id: id,
            $cliente_id: clienteId,
            $fecha: fecha,
            $orden: siguiente?.siguiente ?? 1,
            // La clave de idempotencia es el id local, que no cambia nunca.
            $clave: id,
            // Momento de la captura: viaja como `ocurrido_en` (fuente-rutas).
            $ahora: reloj.ahora(),
          },
        );
      });

      catalogos.publicarCambio();
      const creada = repo.porId(id);
      if (!creada) throw new ErrorRuta('No se pudo leer el cliente recién agregado.');
      return creada;
    },

    /**
     * Guarda el orden que el vendedor dejo con el dedo (D10), en UNA
     * transaccion: si algo falla, se queda el orden anterior entero. No sube
     * (D4) y ningun pull lo toca.
     */
    reordenar(fecha: FechaISO, clienteIds: readonly string[]): void {
      enTransaccion(bd, () => {
        bd.runSync('delete from ruta_orden_local where fecha = $fecha', { $fecha: fecha });
        clienteIds.forEach((clienteId, i) => {
          bd.runSync(
            `insert into ruta_orden_local (fecha, cliente_id, posicion)
             values ($fecha, $cliente_id, $posicion)`,
            { $fecha: fecha, $cliente_id: clienteId, $posicion: i + 1 },
          );
        });
      });
      catalogos.publicarCambio();
    },

    /** Aplica filas del pull en su propia transaccion (pruebas y usos sueltos). */
    aplicarSnapshot(filas: readonly FilaRutaPull[], ahora: MomentoISO = reloj.ahora()): number {
      const escritas = enTransaccion(bd, () => aplicarSnapshotRutas(bd, filas, ahora));
      if (escritas > 0) catalogos.publicarCambio();
      return escritas;
    },

    porId(id: string): Ruta | null {
      return bd.getFirstSync<Ruta>('select * from ruta where id = $id', { $id: id });
    },

    /**
     * Altas locales que faltan por subir, incluidas las rechazadas (patron D19 de
     * ventas): un `cliente-inexistente` se recupera si el portal corrige al
     * cliente. Las filas del servidor (`clave` nula) nunca suben.
     */
    pendientesDeSincronizar(): Ruta[] {
      return bd.getAllSync<Ruta>(
        `select * from ruta
          where clave is not null and sync_estado in ('pendiente', 'error')
          order by fecha, rowid`,
      );
    },

    /** Subida (o `ruta-duplicada`, ver `fuente-rutas.ts`): sale de la cola. */
    marcarSincronizada(id: string): void {
      bd.runSync(
        `update ruta set sync_estado = 'sincronizada', sync_error = null, sincronizado_en = $ahora
          where id = $id and clave is not null`,
        { $ahora: reloj.ahora(), $id: id },
      );
    },

    /** El servidor la rechazo: el motivo se pinta bajo la fila, en rojo. */
    marcarError(id: string, motivo: string): void {
      bd.runSync(
        `update ruta set sync_estado = 'error', sync_error = $motivo
          where id = $id and clave is not null`,
        { $motivo: motivo, $id: id },
      );
      catalogos.publicarCambio();
    },

    /**
     * Quita de la ruta un alta del vendedor que el servidor rechazo. Es el
     * **unico** caso en que se borra una fila desde la tablet: es suya y no
     * existe en el servidor.
     *
     * @throws {ErrorRuta} si la fila no es un alta rechazada.
     */
    quitarRechazada(id: string): void {
      const fila = repo.porId(id);
      if (!fila || fila.origen !== 'vendedor' || fila.sync_estado !== 'error' || fila.clave === null) {
        throw new ErrorRuta('Solo se puede quitar un cliente que agregaste tú y que el servidor rechazó.');
      }
      enTransaccion(bd, () => {
        bd.runSync('delete from ruta where id = $id', { $id: id });
        bd.runSync(
          'delete from ruta_orden_local where fecha = $fecha and cliente_id = $cliente_id',
          { $fecha: fila.fecha, $cliente_id: fila.cliente_id },
        );
      });
      catalogos.publicarCambio();
    },

    /**
     * Borra la ruta y el orden local de los dias anteriores a `antesDe` (por
     * defecto, hoy - 7). Lo llama "Abrir el dia". Las altas que todavia no suben
     * **se conservan**: borrarlas perderia lo que la oficina necesita saber.
     */
    purgar(antesDe: FechaISO = restarDias(reloj.hoy(), 7)): void {
      enTransaccion(bd, () => {
        bd.runSync('delete from ruta_orden_local where fecha < $antes', { $antes: antesDe });
        bd.runSync(
          `delete from ruta
            where fecha < $antes
              and not (clave is not null and sync_estado in ('pendiente', 'error'))`,
          { $antes: antesDe },
        );
      });
    },
  };

  return repo;
}
