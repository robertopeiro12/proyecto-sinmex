import type {
  ContadoCredito,
  FacturaVenta,
  FechaISO,
  Venta,
  VentaLinea,
} from '../tipos';
import { problemasDeCaptura, resumirCaptura, type LineaCaptura } from '../ventas-reglas';
import type { RepositorioCatalogos } from './catalogos';
import type { DepsRepositorio } from './deps';
import { enTransaccion } from './deps';
import type { RepositorioFolios } from './folios';

/** Error de regla de negocio de la venta (no un fallo tecnico de SQLite). */
export class ErrorVenta extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'ErrorVenta';
  }
}

export interface LineaRegistroVenta {
  presentacionId: string;
  cantidad: number;
  cantidadPromocion: number;
}

/**
 * Lo que captura la pantalla. **Sin precios, a proposito** (D15): el precio lo
 * pone este repositorio desde el catalogo local, asi que no hay forma de que un
 * error de la pantalla grabe un precio distinto al del catalogo.
 */
export interface DatosRegistroVenta {
  vendedorId: string;
  clienteId: string;
  numNota: string;
  contadoCredito: ContadoCredito;
  factura: FacturaVenta;
  comentarios: string | null;
  lineas: LineaRegistroVenta[];
}

export type RepositorioVentas = ReturnType<typeof crearRepositorioVentas>;

/**
 * La venta en ruta (T-16): grabar con folio, consultar y la cola del push.
 *
 * Recibe `catalogos` y `folios` ya creados en vez de crearlos: `folios` tiene
 * que ser la **misma instancia** que usa el resto de la capa de datos, y
 * `catalogos` es el que publica la version que observan las pantallas.
 */
export function crearRepositorioVentas(
  { bd, reloj, generarId }: DepsRepositorio,
  { catalogos, folios }: { catalogos: RepositorioCatalogos; folios: RepositorioFolios },
) {
  const repo = {
    /**
     * Graba una venta y le emite su folio, en **una sola transaccion** (D16).
     *
     * Todo lo que puede fallar por una regla (cliente, presentacion, precio,
     * numero de nota) se comprueba ANTES de abrir la transaccion. Lo que falla
     * dentro (sin segmento de folio, 99 operaciones del dia, cualquier error de
     * SQLite) hace `rollback` de todo, **incluido el contador de folios**:
     * `folios.emitir()` usa `savepoint` y se cuelga de esta transaccion. Asi un
     * fallo nunca quema un numero que el vendedor ya no puede usar.
     *
     * @throws {ErrorVenta} si la captura no se puede grabar.
     * @throws {ErrorFolio} si el vendedor no tiene segmento o llego al tope del dia.
     */
    registrar(datos: DatosRegistroVenta): Venta {
      const fecha = reloj.hoy();

      const cliente = catalogos.obtenerCliente(datos.clienteId);
      if (!cliente || cliente.activo !== 1) {
        throw new ErrorVenta(
          'Este cliente ya no está en el catálogo de la tablet. Sincroniza antes de venderle.',
        );
      }

      const vendibles = new Map(
        catalogos
          .presentacionesParaVenta(datos.clienteId, fecha)
          .map((p) => [p.presentacion_id, p] as const),
      );

      const lineas: LineaCaptura[] = datos.lineas.map((l) => {
        const presentacion = vendibles.get(l.presentacionId);
        if (!presentacion) {
          throw new ErrorVenta(
            'Uno de los productos de la venta ya no se vende. Sincroniza y vuelve a capturar.',
          );
        }
        return {
          presentacionId: l.presentacionId,
          etiqueta: `${presentacion.producto_nombre} ${presentacion.volumen}`,
          cantidad: l.cantidad,
          cantidadPromocion: l.cantidadPromocion,
          // D15: el precio sale del catalogo local, nunca de quien llama.
          precioCentavos: presentacion.precio_centavos,
        };
      });

      const problemas = problemasDeCaptura({
        numNota: datos.numNota,
        contadoCredito: datos.contadoCredito,
        comentarios: datos.comentarios ?? '',
        lineas,
      });
      if (problemas.length > 0) {
        throw new ErrorVenta(problemas.join(' '));
      }

      const resumen = resumirCaptura(lineas);
      const id = generarId();
      const ahora = reloj.ahora();
      const comentarios = datos.comentarios?.trim() ? datos.comentarios.trim() : null;

      enTransaccion(bd, () => {
        const emitido = folios.emitir({ vendedorId: datos.vendedorId, claveOperacion: id });

        bd.runSync(
          `insert into venta (
             id, fecha, cliente_id, vendedor_id, sucursal_id, folio, num_nota,
             contado_credito, factura, comentarios, monto_total_centavos,
             grabada_en, sync_estado
           ) values (
             $id, $fecha, $cliente_id, $vendedor_id, $sucursal_id, $folio, $num_nota,
             $contado_credito, $factura, $comentarios, $monto_total_centavos,
             $grabada_en, 'pendiente'
           )`,
          {
            $id: id,
            // La fecha del folio, no otra lectura del reloj: el servidor rechaza
            // un folio cuya fecha no coincide con `fecha_operacion`.
            $fecha: emitido.fecha,
            $cliente_id: datos.clienteId,
            $vendedor_id: datos.vendedorId,
            $sucursal_id: emitido.sucursal_id,
            $folio: emitido.folio,
            $num_nota: datos.numNota.trim(),
            $contado_credito: datos.contadoCredito,
            $factura: datos.factura,
            $comentarios: comentarios,
            $monto_total_centavos: resumen.totalCentavos,
            $grabada_en: ahora,
          },
        );

        for (const l of resumen.lineas) {
          bd.runSync(
            `insert into venta_linea
               (venta_id, presentacion_id, cantidad, cantidad_promocion, precio_centavos)
             values ($venta_id, $presentacion_id, $cantidad, $cantidad_promocion, $precio_centavos)`,
            {
              $venta_id: id,
              $presentacion_id: l.presentacionId,
              $cantidad: l.cantidad,
              $cantidad_promocion: l.cantidadPromocion,
              // Solo puede ser null en una linea de pura promocion (D13).
              $precio_centavos: l.precioCentavos ?? 0,
            },
          );
        }
      });

      const grabada = repo.porId(id);
      if (!grabada) throw new ErrorVenta('No se pudo leer la venta recién grabada.');
      return grabada;
    },

    porId(id: string): Venta | null {
      return bd.getFirstSync<Venta>('select * from venta where id = $id', { $id: id });
    },

    /** Las lineas de una venta, en el orden en que se capturaron. */
    lineasDe(ventaId: string): VentaLinea[] {
      return bd.getAllSync<VentaLinea>(
        'select * from venta_linea where venta_id = $venta_id order by rowid',
        { $venta_id: ventaId },
      );
    },

    /**
     * Ventas de un cliente en un dia, en el orden en que se grabaron. Alimenta
     * "Ventas de hoy" en la ficha del cliente (D18): una venta a credito no es
     * nota pendiente hasta que el servidor la proyecta.
     */
    delDia(clienteId: string, fecha: FechaISO = reloj.hoy()): Venta[] {
      return bd.getAllSync<Venta>(
        `select * from venta
          where cliente_id = $cliente_id and fecha = $fecha
          order by grabada_en, rowid`,
        { $cliente_id: clienteId, $fecha: fecha },
      );
    },

    /**
     * Ventas que faltan por subir.
     *
     * Incluye las que quedaron en `error` (D19), igual que la jornada: un
     * `precio-no-asignado` o `presentacion-inactiva` se recupera cuando el
     * administrador corrige el catalogo. Reenviar es seguro porque la clave es
     * el `id` de la fila, que no cambia.
     */
    pendientesDeSincronizar(): Venta[] {
      return bd.getAllSync<Venta>(
        `select * from venta
          where sync_estado in ('pendiente', 'error')
          order by fecha, grabada_en, rowid`,
      );
    },

    /** Marca una venta como subida y limpia el error de un intento previo. */
    marcarSincronizada(ventaId: string): void {
      bd.runSync(
        `update venta set
           sync_estado = 'sincronizado',
           sincronizado_en = $sincronizado_en,
           sync_error = null
         where id = $id`,
        { $sincronizado_en: reloj.ahora(), $id: ventaId },
      );
    },

    /** El servidor la rechazo: se guarda el motivo para mostrarlo en la ficha. */
    marcarError(ventaId: string, motivo: string): void {
      bd.runSync(`update venta set sync_estado = 'error', sync_error = $motivo where id = $id`, {
        $motivo: motivo,
        $id: ventaId,
      });
    },
  };

  return repo;
}
