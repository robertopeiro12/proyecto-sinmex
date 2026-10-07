import { leerAbonos, problemasDeCobro, repartirPago, type Reparto } from '../cobranzas-reglas';
import type { AbonoNota, Cobranza, FechaISO, MetodoPago } from '../tipos';
import type { RepositorioCatalogos } from './catalogos';
import type { DepsRepositorio } from './deps';
import { enTransaccion } from './deps';

/** Error de regla de negocio del cobro (no un fallo tecnico de SQLite). */
export class ErrorCobranza extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'ErrorCobranza';
  }
}

/** Lo que captura la pantalla. */
export interface DatosRegistroCobranza {
  vendedorId: string;
  clienteId: string;
  /** La nota pendiente que eligio el vendedor. */
  ventaNotaId: string;
  montoCentavos: number;
  metodoPago: MetodoPago;
  /** `AAAA-MM-DD`. */
  fechaPago: string;
}

export type RepositorioCobranzas = ReturnType<typeof crearRepositorioCobranzas>;

/**
 * La cobranza en ruta (T-20): grabar con reparto local, consultar y la cola
 * del push.
 *
 * **Sin folio** (T-21): el cliente aclaro que la cobranza no lleva folio ("Un
 * solo folio"); solo las ventas se numeran. Cobrar ya no gasta un numero de la
 * serie del vendedor.
 *
 * Recibe `catalogos` ya creado, como las ventas: es quien publica la version
 * que observan las pantallas.
 */
export function crearRepositorioCobranzas(
  { bd, reloj, generarId }: DepsRepositorio,
  { catalogos }: { catalogos: RepositorioCatalogos },
) {
  /** Las notas activas del cliente, como las ve el reparto: todas cobrables. */
  function notasParaReparto(clienteId: string) {
    return catalogos.notasPendientesDe(clienteId).map((n) => ({
      id: n.id,
      fecha: n.fecha,
      folio: n.folio,
      cobrable: true,
      saldoCentavos: n.saldo_centavos,
    }));
  }

  const repo = {
    /**
     * El reparto que hara `registrar`, sin escribir nada. Lo muestra la
     * pantalla en la revision (D16).
     */
    previsualizar(clienteId: string, ventaNotaId: string, montoCentavos: number): Reparto {
      return repartirPago(montoCentavos, ventaNotaId, notasParaReparto(clienteId));
    },

    /**
     * Graba un cobro y aplica el reparto local, en **una sola transaccion**
     * (D15). Sin folio (T-21).
     *
     * Todo lo que puede fallar por una regla se comprueba ANTES de abrir la
     * transaccion. Lo que falla dentro (SQLite) hace `rollback` de todo.
     *
     * @throws {ErrorCobranza} si la captura no se puede grabar.
     */
    registrar(datos: DatosRegistroCobranza): Cobranza {
      const hoy = reloj.hoy();

      const cliente = catalogos.obtenerCliente(datos.clienteId);
      if (!cliente || cliente.activo !== 1) {
        throw new ErrorCobranza(
          'Este cliente ya no está en el catálogo de la tablet. Sincroniza antes de cobrarle.',
        );
      }

      // La sucursal del cobro es la del vendedor, como la de la venta (antes
      // salia del folio emitido).
      const vendedor = bd.getFirstSync<{ sucursal_id: string }>(
        'select sucursal_id from vendedor where id = $id',
        { $id: datos.vendedorId },
      );
      if (!vendedor) {
        throw new ErrorCobranza('Este vendedor no está en la tablet. Sincroniza antes de cobrar.');
      }

      const nota = catalogos
        .notasPendientesDe(datos.clienteId)
        .find((n) => n.id === datos.ventaNotaId);
      if (!nota) {
        throw new ErrorCobranza(
          'Esa nota ya no está pendiente para este cliente. Sincroniza y vuelve a intentarlo.',
        );
      }

      const problemas = problemasDeCobro({
        notaFecha: nota.fecha,
        montoCentavos: datos.montoCentavos,
        metodoPago: datos.metodoPago,
        fechaPago: datos.fechaPago,
        hoy,
      });
      if (problemas.length > 0) {
        throw new ErrorCobranza(problemas.join(' '));
      }

      const fechaPago = datos.fechaPago.trim();
      const reparto = repartirPago(datos.montoCentavos, datos.ventaNotaId, notasParaReparto(datos.clienteId));
      const id = generarId();
      const ahora = reloj.ahora();

      enTransaccion(bd, () => {
        bd.runSync(
          `insert into cobranza (
             id, fecha, cliente_id, vendedor_id, sucursal_id, venta_nota_id,
             monto_centavos, metodo_pago, fecha_pago, grabada_en, sync_estado
           ) values (
             $id, $fecha, $cliente_id, $vendedor_id, $sucursal_id, $venta_nota_id,
             $monto_centavos, $metodo_pago, $fecha_pago, $grabada_en, 'pendiente'
           )`,
          {
            $id: id,
            // El dia de trabajo: viaja como `fecha_operacion`.
            $fecha: hoy,
            $cliente_id: datos.clienteId,
            $vendedor_id: datos.vendedorId,
            $sucursal_id: vendedor.sucursal_id,
            $venta_nota_id: datos.ventaNotaId,
            $monto_centavos: datos.montoCentavos,
            $metodo_pago: datos.metodoPago,
            $fecha_pago: fechaPago,
            $grabada_en: ahora,
          },
        );

        // Reparto local (D15): el siguiente pull lo pisa con la verdad del servidor.
        for (const a of reparto.aplicaciones) {
          const actual = bd.getFirstSync<{ abonos_json: string }>(
            'select abonos_json from nota_pendiente where id = $id',
            { $id: a.notaId },
          );
          const abonos: AbonoNota[] = [
            ...leerAbonos(actual?.abonos_json ?? '[]'),
            { fecha_pago: fechaPago, monto_centavos: a.montoCentavos, metodo_pago: datos.metodoPago },
          ];
          bd.runSync(
            `update nota_pendiente set
               saldo_centavos = $saldo,
               -- El CHECK local solo admite pendiente/abonado: una nota en 0
               -- se retira con activo = 0, no con 'pagada'.
               status = 'abonado',
               activo = $activo,
               abonos_json = $abonos_json
             where id = $id`,
            {
              $saldo: a.saldoDespuesCentavos,
              $activo: a.saldoDespuesCentavos === 0 ? 0 : 1,
              $abonos_json: JSON.stringify(abonos),
              $id: a.notaId,
            },
          );
        }

        if (reparto.saldoFavorCentavos > 0) {
          bd.runSync(
            `update cliente set saldo_favor_centavos = saldo_favor_centavos + $monto where id = $id`,
            { $monto: reparto.saldoFavorCentavos, $id: datos.clienteId },
          );
        }
      });

      // Despues del commit: la ficha y la venta releen notas y saldo a favor.
      // Si un oyente truena, el cobro ya esta grabado: no puede propagarse como
      // si la grabacion hubiera fallado (la pantalla diria "no se guardo nada"
      // e invitaria a cobrar dos veces).
      try {
        catalogos.publicarCambio();
      } catch {
        // Solo se pierde el refresco de pantallas abiertas; el cobro esta firme.
      }

      const grabada = repo.porId(id);
      if (!grabada) throw new ErrorCobranza('No se pudo leer el cobro recién grabado.');
      return grabada;
    },

    porId(id: string): Cobranza | null {
      return bd.getFirstSync<Cobranza>('select * from cobranza where id = $id', { $id: id });
    },

    /** Cobros de un cliente en un dia, en el orden en que se grabaron ("Cobros de hoy", D16). */
    delDia(clienteId: string, fecha: FechaISO = reloj.hoy()): Cobranza[] {
      return bd.getAllSync<Cobranza>(
        `select * from cobranza
          where cliente_id = $cliente_id and fecha = $fecha
          order by grabada_en, rowid`,
        { $cliente_id: clienteId, $fecha: fecha },
      );
    },

    /**
     * Cobros que faltan por subir, incluidos los rechazados (patron D19 de
     * T-16): un `nota-no-encontrada` sobre una venta que aun no subio se
     * recupera solo cuando la venta entra. Reenviar es seguro: la clave no cambia.
     */
    pendientesDeSincronizar(): Cobranza[] {
      return bd.getAllSync<Cobranza>(
        `select * from cobranza
          where sync_estado in ('pendiente', 'error')
          order by fecha, grabada_en, rowid`,
      );
    },

    /** Marca un cobro como subido y limpia el error de un intento previo. */
    marcarSincronizada(id: string): void {
      bd.runSync(
        `update cobranza set
           sync_estado = 'sincronizado',
           sincronizado_en = $sincronizado_en,
           sync_error = null
         where id = $id`,
        { $sincronizado_en: reloj.ahora(), $id: id },
      );
    },

    /** El servidor lo rechazo: se guarda el motivo para mostrarlo. */
    marcarError(id: string, motivo: string): void {
      bd.runSync(`update cobranza set sync_estado = 'error', sync_error = $motivo where id = $id`, {
        $motivo: motivo,
        $id: id,
      });
    },
  };

  return repo;
}
