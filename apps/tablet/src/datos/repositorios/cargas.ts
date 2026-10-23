import type { BaseDatos } from '../base-datos';
import {
  bloqueoDeVenta,
  cargaPendiente,
  existencias,
  type CargaInventario,
  type Existencia,
  type LineaMovimientoInventario,
  type LineaVentaInventario,
} from '../inventario-reglas';
import type { Booleano, Carga, CargaDetalle, EstadoCarga, FechaISO, MomentoISO } from '../tipos';
import type { RepositorioCatalogos } from './catalogos';
import type { DepsRepositorio } from './deps';
import { enTransaccion } from './deps';

/**
 * Una carga como la manda el pull (`CargaPull` del contrato) o la respuesta del
 * servidor al aceptar/rechazar. Estructural a proposito: la capa de datos no
 * importa el contrato, y `aSnapshot` le pasa las filas tal cual.
 */
export interface FilaCargaPull {
  id: string;
  vendedor_id: string;
  fecha: FechaISO;
  numero: number;
  estado: EstadoCarga;
  motivo_rechazo: string | null;
  version: number;
  respondida_en: MomentoISO | null;
  activo: Booleano;
  lineas: { presentacion_id: string; piezas: number }[];
}

export interface LineaCargaConEtiqueta extends CargaDetalle {
  /** "Jamaica 1 L", o `PRODUCTO_FUERA_DE_CATALOGO` si la presentacion aun no baja. */
  etiqueta: string;
}

export interface CargaConLineas extends Carga {
  lineas: LineaCargaConEtiqueta[];
}

/**
 * Una fila de la tabla de Inventario: Cargado − Vendido − Regalado − Merma
 * entregada − Merma del trayecto − Consumo = Existencia, y la merma por regresar.
 */
export interface FilaInventario extends Existencia {
  presentacionId: string;
  etiqueta: string;
}

/** Lo que la pantalla de venta lee al abrir (la red definitiva es `ventas.registrar`). */
export interface InventarioParaVenta {
  controlInventario: boolean;
  bloqueo: string | null;
  existencias: Map<string, Existencia>;
}

export const PRODUCTO_FUERA_DE_CATALOGO = 'Producto fuera del catálogo';

/**
 * ¿La fila que llega es mas vieja que la que ya hay? Entonces no se escribe:
 *
 * - Una baja es final: nada la revive (el portal no tiene "deshacer baja").
 * - La baja que llega siempre entra.
 * - Una version menor llega tarde: el portal ya la edito despues.
 * - Misma version, la local ya respondida y la que llega pendiente: es un pull
 *   que salio ANTES de que el vendedor aceptara o rechazara. Sin esto, la carga
 *   aceptada volveria a "por aceptar" hasta el pull siguiente.
 */
function llegaTarde(
  local: Pick<Carga, 'estado' | 'version' | 'activo'>,
  fila: FilaCargaPull,
): boolean {
  if (local.activo === 0) return true;
  if (fila.activo === 0) return false;
  if (fila.version < local.version) return true;
  return fila.version === local.version && fila.estado === 'pendiente' && local.estado !== 'pendiente';
}

/**
 * Aplica las cargas del pull (o la que contesto el servidor). Sin transaccion
 * propia: la llama `catalogos.guardarSnapshot` dentro de la suya (y
 * `aplicarRespuesta` abre una). Por cada fila: upsert por `id` y las lineas se
 * **reemplazan** (el servidor manda siempre la carga completa).
 *
 * @returns cuantas filas escribio (para que `guardarSnapshot` sepa si avisar).
 */
export function aplicarSnapshotCargas(
  bd: BaseDatos,
  filas: readonly FilaCargaPull[] | undefined,
  actualizadoEn: MomentoISO,
): number {
  if (!filas || filas.length === 0) return 0;
  let escritas = 0;
  for (const f of filas) {
    const local = bd.getFirstSync<Pick<Carga, 'estado' | 'version' | 'activo'>>(
      'select estado, version, activo from carga where id = $id',
      { $id: f.id },
    );
    if (local && llegaTarde(local, f)) continue;

    bd.runSync(
      `insert into carga (id, vendedor_id, fecha, numero, estado, motivo_rechazo, version,
                          respondida_en, activo, actualizado_en)
       values ($id, $vendedor_id, $fecha, $numero, $estado, $motivo_rechazo, $version,
               $respondida_en, $activo, $actualizado_en)
       on conflict(id) do update set
         vendedor_id = excluded.vendedor_id,
         fecha = excluded.fecha,
         numero = excluded.numero,
         estado = excluded.estado,
         motivo_rechazo = excluded.motivo_rechazo,
         version = excluded.version,
         respondida_en = excluded.respondida_en,
         activo = excluded.activo,
         actualizado_en = excluded.actualizado_en`,
      {
        $id: f.id,
        $vendedor_id: f.vendedor_id,
        $fecha: f.fecha,
        $numero: f.numero,
        $estado: f.estado,
        $motivo_rechazo: f.motivo_rechazo,
        $version: f.version,
        $respondida_en: f.respondida_en,
        $activo: f.activo,
        $actualizado_en: actualizadoEn,
      },
    );
    bd.runSync('delete from carga_detalle where carga_id = $id', { $id: f.id });
    for (const l of f.lineas) {
      bd.runSync(
        `insert into carga_detalle (carga_id, presentacion_id, piezas)
         values ($carga_id, $presentacion_id, $piezas)`,
        { $carga_id: f.id, $presentacion_id: l.presentacion_id, $piezas: l.piezas },
      );
    }
    escritas += 1;
  }
  return escritas;
}

/**
 * Lo que el inventario de hoy necesita, leido de SQLite: la casilla y el limite
 * de consumo del vendedor, sus cargas del dia (con lineas), las lineas de sus
 * ventas del dia y, desde la pieza 2, las de sus movimientos del dia.
 *
 * La usan `ventas.registrar` y `movimientos.registrar` DENTRO de su transaccion
 * (vale la existencia del momento de grabar) y este repositorio para las
 * pantallas.
 */
export function leerInventarioDelDia(
  bd: BaseDatos,
  vendedorId: string,
  fecha: FechaISO,
): {
  controlInventario: boolean;
  consumoDiarioMax: number;
  cargas: CargaInventario[];
  ventas: LineaVentaInventario[];
  movimientos: LineaMovimientoInventario[];
} {
  const vendedor = bd.getFirstSync<{ control_inventario: number; consumo_diario_max: number }>(
    'select control_inventario, consumo_diario_max from vendedor where id = $id',
    { $id: vendedorId },
  );
  const cargas = bd.getAllSync<Carga>(
    'select * from carga where vendedor_id = $vendedor_id and fecha = $fecha order by numero',
    { $vendedor_id: vendedorId, $fecha: fecha },
  );
  const detalle = bd.getAllSync<CargaDetalle>(
    `select d.* from carga_detalle d
       join carga c on c.id = d.carga_id
      where c.vendedor_id = $vendedor_id and c.fecha = $fecha`,
    { $vendedor_id: vendedorId, $fecha: fecha },
  );
  const ventas = bd.getAllSync<LineaVentaInventario>(
    `select v.fecha, l.presentacion_id, l.cantidad, l.cantidad_promocion
       from venta_linea l
       join venta v on v.id = l.venta_id
      where v.vendedor_id = $vendedor_id and v.fecha = $fecha`,
    { $vendedor_id: vendedorId, $fecha: fecha },
  );
  // T-27 pieza 2: todos los del dia, suban o no (las piezas ya salieron).
  const movimientos = bd.getAllSync<LineaMovimientoInventario>(
    `select m.fecha, m.tipo, l.sentido, l.presentacion_id, l.piezas
       from movimiento_linea l
       join movimiento m on m.id = l.movimiento_id
      where m.vendedor_id = $vendedor_id and m.fecha = $fecha`,
    { $vendedor_id: vendedorId, $fecha: fecha },
  );
  return {
    controlInventario: vendedor?.control_inventario === 1,
    // Un vendedor que no esta en la tablet no tiene consumo (registrar ya lo rechaza antes).
    consumoDiarioMax: vendedor?.consumo_diario_max ?? 0,
    cargas: cargas.map((c) => ({ ...c, lineas: detalle.filter((d) => d.carga_id === c.id) })),
    ventas,
    movimientos,
  };
}

/**
 * "Producto volumen" de todo el catalogo local (es chico); tambien de las dadas
 * de baja. La usan las cargas y los movimientos (T-27 pieza 2) para nombrar sus
 * lineas.
 */
export function etiquetasDelCatalogo(bd: BaseDatos): Map<string, string> {
  const filas = bd.getAllSync<{ id: string; etiqueta: string }>(
    `select pr.id, p.nombre || ' ' || pr.volumen as etiqueta
       from presentacion pr
       join producto p on p.id = pr.producto_id`,
  );
  return new Map(filas.map((f) => [f.id, f.etiqueta]));
}

export type RepositorioCargas = ReturnType<typeof crearRepositorioCargas>;

/**
 * La carga y las recargas del vendedor en la tablet (T-27 pieza 1). Recibe el
 * MISMO `catalogos` de la capa de datos: es quien publica la version que
 * observan las pantallas (`aplicarRespuesta` avisa por el).
 */
export function crearRepositorioCargas(
  { bd, reloj }: DepsRepositorio,
  { catalogos }: { catalogos: RepositorioCatalogos },
) {
  function conLineas(cargas: readonly Carga[]): CargaConLineas[] {
    if (cargas.length === 0) return [];
    const nombres = etiquetasDelCatalogo(bd);
    return cargas.map((c) => ({
      ...c,
      lineas: bd
        .getAllSync<CargaDetalle>('select * from carga_detalle where carga_id = $id', { $id: c.id })
        .map((l) => ({ ...l, etiqueta: nombres.get(l.presentacion_id) ?? PRODUCTO_FUERA_DE_CATALOGO }))
        .sort((a, b) => a.etiqueta.localeCompare(b.etiqueta, 'es')),
    }));
  }

  function delDia(vendedorId: string, fecha: FechaISO = reloj.hoy()): CargaConLineas[] {
    return conLineas(
      bd.getAllSync<Carga>(
        `select * from carga
          where vendedor_id = $vendedor_id and fecha = $fecha and activo = 1
          order by numero`,
        { $vendedor_id: vendedorId, $fecha: fecha },
      ),
    );
  }

  return {
    /** Las cargas vivas de hoy del vendedor, por numero, con sus lineas: la lista de Inventario. */
    delDia,

    /** Una carga por id, viva o no (el detalle dice "ya no existe" si se dio de baja). */
    porId(id: string): CargaConLineas | null {
      const carga = bd.getFirstSync<Carga>('select * from carga where id = $id', { $id: id });
      return carga ? (conLineas([carga])[0] ?? null) : null;
    },

    /** La que hay que aceptar primero: el aviso de la pantalla principal (con o sin control). */
    pendienteDeHoy(vendedorId: string): CargaConLineas | null {
      return cargaPendiente(delDia(vendedorId), reloj.hoy());
    },

    controlInventario(vendedorId: string): boolean {
      return leerInventarioDelDia(bd, vendedorId, reloj.hoy()).controlInventario;
    },

    /** Lo que la pantalla de venta pinta al abrir: bloqueo y "Te quedan N". */
    paraVenta(vendedorId: string): InventarioParaVenta {
      const hoy = reloj.hoy();
      const inventario = leerInventarioDelDia(bd, vendedorId, hoy);
      return {
        controlInventario: inventario.controlInventario,
        bloqueo: bloqueoDeVenta({
          controlInventario: inventario.controlInventario,
          cargas: inventario.cargas,
          hoy,
        }),
        existencias: existencias(inventario.cargas, inventario.ventas, hoy, inventario.movimientos),
      };
    },

    /** La tabla de Inventario, por nombre de producto y volumen. */
    filasInventario(vendedorId: string): FilaInventario[] {
      const hoy = reloj.hoy();
      const inventario = leerInventarioDelDia(bd, vendedorId, hoy);
      const nombres = etiquetasDelCatalogo(bd);
      return [...existencias(inventario.cargas, inventario.ventas, hoy, inventario.movimientos)]
        .map(([presentacionId, e]) => ({
          presentacionId,
          etiqueta: nombres.get(presentacionId) ?? PRODUCTO_FUERA_DE_CATALOGO,
          ...e,
        }))
        .sort((a, b) => a.etiqueta.localeCompare(b.etiqueta, 'es'));
    },

    /**
     * Escribe la carga que contesto el servidor (200 o el cuerpo de un 409) y
     * avisa a las pantallas, despues del `commit`.
     */
    aplicarRespuesta(fila: FilaCargaPull): void {
      enTransaccion(bd, () => aplicarSnapshotCargas(bd, [fila], reloj.ahora()));
      // Como en `ventas.registrar`: un oyente que truena no convierte en fallo
      // una respuesta que ya quedo escrita (y que el servidor ya tiene).
      try {
        catalogos.publicarCambio();
      } catch {
        // Solo se pierde el refresco de pantallas abiertas; la carga esta firme.
      }
    },
  };
}
