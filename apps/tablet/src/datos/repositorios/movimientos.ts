import {
  bloqueoDeVenta,
  consumoDelDia,
  existencias,
  faltantesDeMovimiento,
  textoFaltante,
} from '../inventario-reglas';
import { motivoDeConsumo, validarMovimiento, type LineaMovimiento } from '../movimientos-reglas';
import type { FechaISO, Movimiento, MovimientoLinea, TipoMovimiento } from '../tipos';
import { etiquetasDelCatalogo, leerInventarioDelDia, PRODUCTO_FUERA_DE_CATALOGO } from './cargas';
import type { RepositorioCatalogos } from './catalogos';
import { enTransaccion, type DepsRepositorio } from './deps';
import { exigirJornadaAbierta } from './jornadas';

/** Error de regla de negocio del movimiento (no un fallo tecnico de SQLite). */
export class ErrorMovimiento extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'ErrorMovimiento';
  }
}

/** Lo que graba una pantalla (Merma de la ficha o la captura del menu). */
export interface DatosRegistroMovimiento {
  vendedorId: string;
  tipo: TipoMovimiento;
  /** Solo en la merma del cliente. */
  clienteId: string | null;
  lineas: LineaMovimiento[];
  comentario: string | null;
}

export interface LineaMovimientoConEtiqueta extends MovimientoLinea {
  /** "Jamaica 1 L", o `PRODUCTO_FUERA_DE_CATALOGO`. */
  etiqueta: string;
}

export interface MovimientoConLineas extends Movimiento {
  /** Primero lo recibido, luego lo entregado, en orden de captura. */
  lineas: LineaMovimientoConEtiqueta[];
}

/** Una fila de captura: las presentaciones activas del catalogo local. */
export interface PresentacionMovimiento {
  presentacionId: string;
  etiqueta: string;
}

export type RepositorioMovimientos = ReturnType<typeof crearRepositorioMovimientos>;

/**
 * Los movimientos de inventario (T-27 pieza 2): la merma del cliente, la del
 * trayecto y el consumo propio. Grabar, consultar el dia y la cola del push.
 *
 * Un movimiento grabado **no se edita ni se borra** en la app (D6): la
 * correccion es de la oficina (T-35). Por eso no hay `editar` ni `eliminar`.
 *
 * Recibe el MISMO `catalogos` de la capa de datos: es quien publica la version
 * que observan Inventario, la ficha y "Merma y consumo".
 */
export function crearRepositorioMovimientos(
  { bd, reloj, generarId }: DepsRepositorio,
  { catalogos }: { catalogos: RepositorioCatalogos },
) {
  function conLineas(movimientos: readonly Movimiento[]): MovimientoConLineas[] {
    if (movimientos.length === 0) return [];
    const nombres = etiquetasDelCatalogo(bd);
    return movimientos.map((m) => ({
      ...m,
      lineas: bd
        .getAllSync<MovimientoLinea>(
          // 'recibido' > 'entregado': desc pone primero lo que devolvio el cliente.
          'select * from movimiento_linea where movimiento_id = $id order by sentido desc, rowid',
          { $id: m.id },
        )
        .map((l) => ({ ...l, etiqueta: nombres.get(l.presentacion_id) ?? PRODUCTO_FUERA_DE_CATALOGO })),
    }));
  }

  const repo = {
    /**
     * Graba un movimiento en **una sola transaccion**, listo para subir.
     *
     * La forma, el cliente y las presentaciones se revisan antes; el limite de
     * consumo (D4), la carga pendiente y los faltantes (D5) se calculan DENTRO
     * de la transaccion, con la base tal como esta al grabar (como
     * `ventas.registrar`). Un throw hace rollback: nada queda escrito.
     *
     * @throws {ErrorJornada} si el dia de hoy ya esta cerrado (T-38): primero el candado.
     * @throws {ErrorMovimiento} si el movimiento no se puede grabar.
     */
    registrar(datos: DatosRegistroMovimiento): MovimientoConLineas {
      exigirJornadaAbierta({ bd, reloj }, datos.vendedorId);

      const vendedor = bd.getFirstSync<{ id: string }>('select id from vendedor where id = $id', {
        $id: datos.vendedorId,
      });
      if (!vendedor) {
        throw new ErrorMovimiento('Este vendedor no está en la tablet. Sincroniza antes de registrar.');
      }

      const comentario = recortar(datos.comentario);
      const errores = validarMovimiento({ ...datos, comentario });
      if (errores.length > 0) throw new ErrorMovimiento(errores.join(' '));

      if (datos.clienteId !== null) {
        const cliente = catalogos.obtenerCliente(datos.clienteId);
        if (!cliente || cliente.activo !== 1) {
          throw new ErrorMovimiento(
            'Este cliente ya no está en el catálogo de la tablet. Sincroniza antes de registrar la merma.',
          );
        }
      }

      const nombres = etiquetasDelCatalogo(bd);
      if (datos.lineas.some((l) => !nombres.has(l.presentacionId))) {
        throw new ErrorMovimiento('Un producto no está en el catálogo de la tablet. Sincroniza y vuelve a capturar.');
      }

      const fecha = reloj.hoy();
      const id = generarId();
      const salen = datos.lineas
        .filter((l) => l.sentido === 'entregado')
        .map((l) => ({ presentacionId: l.presentacionId, cantidad: l.piezas }));

      enTransaccion(bd, () => {
        const inventario = leerInventarioDelDia(bd, datos.vendedorId, fecha);

        if (datos.tipo === 'consumo') {
          const motivo = motivoDeConsumo({
            limite: inventario.consumoDiarioMax,
            consumoDeHoy: consumoDelDia(inventario.movimientos, fecha),
            piezas: salen.reduce((total, l) => total + l.cantidad, 0),
          });
          if (motivo !== null) throw new ErrorMovimiento(`${motivo}.`);
        }

        // D5: solo lo que saca piezas buenas respeta la carga pendiente y la existencia.
        if (salen.length > 0) {
          const bloqueo = bloqueoDeVenta({
            controlInventario: inventario.controlInventario,
            cargas: inventario.cargas,
            hoy: fecha,
          });
          if (bloqueo !== null) {
            throw new ErrorMovimiento(`${bloqueo}. Acéptala en Inventario antes de sacar piezas de la camioneta.`);
          }
          const faltantes = faltantesDeMovimiento({
            controlInventario: inventario.controlInventario,
            existencias: existencias(inventario.cargas, inventario.ventas, fecha, inventario.movimientos),
            lineasQueSalen: salen,
          });
          if (faltantes.length > 0) {
            throw new ErrorMovimiento(
              `No te alcanza el producto: ${faltantes
                .map((f) => textoFaltante(nombres.get(f.presentacionId) ?? 'Un producto', f.faltan))
                .join('; ')}.`,
            );
          }
        }

        bd.runSync(
          `insert into movimiento (id, fecha, vendedor_id, cliente_id, tipo, comentario, registrado_en, sync_estado)
           values ($id, $fecha, $vendedor_id, $cliente_id, $tipo, $comentario, $registrado_en, 'pendiente')`,
          {
            $id: id,
            // El dia de trabajo de la tablet (Tijuana): viaja como `fecha_operacion`.
            $fecha: fecha,
            $vendedor_id: datos.vendedorId,
            $cliente_id: datos.clienteId,
            $tipo: datos.tipo,
            $comentario: comentario,
            $registrado_en: reloj.ahora(),
          },
        );
        for (const l of datos.lineas) {
          bd.runSync(
            `insert into movimiento_linea (movimiento_id, presentacion_id, sentido, piezas)
             values ($movimiento_id, $presentacion_id, $sentido, $piezas)`,
            { $movimiento_id: id, $presentacion_id: l.presentacionId, $sentido: l.sentido, $piezas: l.piezas },
          );
        }
      });

      // Despues del commit: Inventario, la ficha y "Merma y consumo" releen. Un
      // oyente que truena no convierte en fallo un movimiento ya grabado.
      try {
        catalogos.publicarCambio();
      } catch {
        // Solo se pierde el refresco de pantallas abiertas.
      }

      const grabado = repo.porId(id);
      if (!grabado) throw new ErrorMovimiento('No se pudo leer el movimiento recién grabado.');
      return grabado;
    },

    porId(id: string): MovimientoConLineas | null {
      const m = bd.getFirstSync<Movimiento>('select * from movimiento where id = $id', { $id: id });
      return m ? (conLineas([m])[0] ?? null) : null;
    },

    /** Los del vendedor en un dia, en orden de captura ("Movimientos de hoy" del menu). */
    delDia(vendedorId: string, fecha: FechaISO = reloj.hoy()): MovimientoConLineas[] {
      return conLineas(
        bd.getAllSync<Movimiento>(
          `select * from movimiento where vendedor_id = $vendedor_id and fecha = $fecha
            order by registrado_en, rowid`,
          { $vendedor_id: vendedorId, $fecha: fecha },
        ),
      );
    },

    /** La merma registrada con ese cliente en un dia ("Movimientos de hoy" de la ficha). */
    delDiaDelCliente(clienteId: string, fecha: FechaISO = reloj.hoy()): MovimientoConLineas[] {
      return conLineas(
        bd.getAllSync<Movimiento>(
          `select * from movimiento where cliente_id = $cliente_id and fecha = $fecha
            order by registrado_en, rowid`,
          { $cliente_id: clienteId, $fecha: fecha },
        ),
      );
    },

    /** Piezas de consumo propio de hoy (todas, suban o no). */
    consumoDeHoy(vendedorId: string): number {
      const hoy = reloj.hoy();
      return consumoDelDia(leerInventarioDelDia(bd, vendedorId, hoy).movimientos, hoy);
    },

    /** El limite de su sucursal (D4); 0 = no se ofrece consumo. */
    consumoDiarioMax(vendedorId: string): number {
      return leerInventarioDelDia(bd, vendedorId, reloj.hoy()).consumoDiarioMax;
    },

    /** Las presentaciones activas, por producto y volumen: las filas de captura (de cualquier sabor y tamaño, D2). */
    presentaciones(): PresentacionMovimiento[] {
      return bd.getAllSync<PresentacionMovimiento>(
        `select pr.id as presentacionId, p.nombre || ' ' || pr.volumen as etiqueta
           from presentacion pr
           join producto p on p.id = pr.producto_id
          where pr.activo = 1 and p.activo = 1
          order by p.nombre, pr.volumen`,
      );
    },

    /**
     * Lo que falta por subir, incluidos los rechazados (patron D19 de T-16): se
     * reintentan en la siguiente sincronizacion con la misma clave (Review Focus 4).
     */
    pendientesDeSincronizar(): MovimientoConLineas[] {
      return conLineas(
        bd.getAllSync<Movimiento>(
          `select * from movimiento where sync_estado in ('pendiente', 'error')
            order by fecha, registrado_en, rowid`,
        ),
      );
    },

    marcarSincronizada(id: string): void {
      bd.runSync(
        `update movimiento set sync_estado = 'sincronizado', sincronizado_en = $en, sync_error = null
          where id = $id`,
        { $en: reloj.ahora(), $id: id },
      );
    },

    marcarError(id: string, motivo: string): void {
      bd.runSync(`update movimiento set sync_estado = 'error', sync_error = $motivo where id = $id`, {
        $motivo: motivo,
        $id: id,
      });
    },
  };

  return repo;
}

/** Texto recortado no vacio, o `null`. */
function recortar(valor: string | null): string | null {
  if (valor === null) return null;
  const limpio = valor.trim();
  return limpio === '' ? null : limpio;
}
