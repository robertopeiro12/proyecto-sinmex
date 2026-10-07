import { Injectable } from '@nestjs/common';
import type { Transaction } from 'kysely';
import type { DB } from '../../database/schema';
import { PreciosRepository } from '../cartera-clientes/precios.repository';
import { aPesos } from '../sincronizacion/dinero';
import { CobranzasRepository } from './cobranzas.repository';
import type { VentaNormalizada } from './datos-venta';
import {
  mesDe,
  montoTotalCentavos,
  revisarLineas,
  semanaISO,
  statusInicial,
  type StatusInicial,
} from './reglas-venta';
import { VentaRechazada } from './venta-rechazada';
import { VentasRepository } from './ventas.repository';

/** De donde viene la venta (T-17). La base lo guarda en `venta_nota.origen`. */
export type OrigenVenta = 'app' | 'portal';

/** Como se cobra sola una venta de contado (T-17, §2). */
export type MetodoPagoContado = 'efectivo' | 'transferencia';

/**
 * Quien y cuando (ADR-0009 §2.2, con la enmienda de T-16: sin
 * `syncOperacionId`, la trazabilidad va en `sync_operacion.entidad_*`).
 */
export interface ContextoVenta {
  /** Sucursal de la operacion. Desde la tablet, la del vendedor del token; desde el portal, la del cliente. */
  sucursalId: string;
  /** Dia de trabajo `AAAA-MM-DD` tal cual llego: de aqui salen fecha, semana y mes, y desde aqui se mide la existencia de precio. */
  fechaOperacion: string;
  /**
   * El repartidor de la venta. `null` solo en una venta de **Oficina** (venta
   * de mostrador, T-17): no genera comision. La base lo exige con
   * `ck_venta_nota_origen_actores`: sin vendedor solo si `origen = 'portal'`.
   */
  vendedorId: string | null;
  /** Siempre llega: el de la tablet (offline) o el de oficina que emite el servidor (T-17). */
  folio: string;
  /** Quien la capturo en el portal (T-17). No sustituye a `vendedorId`. `null` desde la tablet. */
  usuarioId: string | null;
  /**
   * `app`: el precio lo pone la nota firmada y solo se comprueba que exista
   * alguno hasta hoy (D2, D12 enmendada). `portal`: los precios ya vienen
   * resueltos por el servidor a la fecha de la venta, y la existencia se mide
   * exactamente a esa fecha.
   */
  origen: OrigenVenta;
  /** El metodo del cobro automatico de una venta de contado. La tablet manda `efectivo`. */
  metodoPagoContado: MetodoPagoContado;
}

/** Lo que el portal muestra al grabar (T-17). La tablet solo usa el `id`. */
export interface VentaRegistrada {
  id: string;
  montoCentavos: number;
  status: StatusInicial;
}

/**
 * La venta (T-16): **una regla, un sitio** (ADR-0009). La tablet entra por el
 * `push` y el portal por `VentasPortalService` (T-17), los dos por aqui. Asi el
 * monto de una venta del portal se calcula igual que el de la tablet: es el
 * criterio del bug v2.0 de T-17.
 */
@Injectable()
export class VentasService {
  constructor(
    private readonly repo: VentasRepository,
    private readonly precios: PreciosRepository,
    // T-20 (D2): la venta de contado deja su cobro en la misma transaccion.
    private readonly cobranzas: CobranzasRepository,
  ) {}

  /**
   * Registra una venta cuya forma ya valido `normalizarDatosVenta`, dentro de
   * la transaccion de quien llama.
   *
   * No compara precios (D2): solo exige que cada presentacion se venda y que
   * las lineas con cantidad tengan algun precio para el cliente (ver
   * `ContextoVenta.origen`). El monto y el status los calcula aqui (D4, D14) y
   * congela el % de comision del cliente (D8).
   *
   * @throws {VentaRechazada} si el cliente no es de la sucursal, una
   * presentacion no se vende o falta precio. No escribe nada antes de lanzar.
   */
  async registrarVenta(
    venta: VentaNormalizada,
    contexto: ContextoVenta,
    trx: Transaction<DB>,
  ): Promise<VentaRegistrada> {
    const cliente = await this.repo.clienteParaVenta(
      venta.clienteId,
      contexto.sucursalId,
      trx,
    );
    if (!cliente) {
      throw new VentaRechazada({
        razon: 'cliente-fuera-de-alcance',
        motivo: `El cliente ${venta.clienteId} no existe o no es de esta sucursal.`,
      });
    }

    // Desde la tablet, existencia de precio hasta hoy, no solo a la fecha: el
    // portal asigna precios con vigencia desde hoy y el rechazo promete que
    // asignarlo recupera la venta (enmienda de D12). Desde el portal (T-17), a
    // la fecha exacta: la venta pasada mantiene el precio que tenia entonces.
    const precios = await this.precios.presentacionesConPrecio(
      venta.clienteId,
      contexto.fechaOperacion,
      trx,
      { vigenteHastaHoy: contexto.origen === 'app' },
    );
    const rechazo = revisarLineas(venta.lineas, precios);
    if (rechazo) throw new VentaRechazada(rechazo);

    const monto = montoTotalCentavos(venta.lineas);
    const status = statusInicial(venta.contadoCredito, monto);
    const id = await this.repo.insertarVenta(
      {
        folio: contexto.folio,
        fecha: contexto.fechaOperacion,
        clienteId: venta.clienteId,
        vendedorId: contexto.vendedorId,
        sucursalId: contexto.sucursalId,
        montoTotal: aPesos(monto),
        numNota: venta.numNota,
        contadoCredito: venta.contadoCredito,
        factura: venta.factura,
        comentarios: venta.comentarios,
        semana: semanaISO(contexto.fechaOperacion),
        mes: mesDe(contexto.fechaOperacion),
        status,
        // Una venta de Oficina (sin vendedor) no genera comision: no se
        // congela el % del cliente.
        pctComision: contexto.vendedorId === null ? null : cliente.pctComision,
        origen: contexto.origen,
        capturoUsuarioId: contexto.usuarioId,
      },
      trx,
    );

    await this.repo.insertarDetalle(
      id,
      venta.lineas.map((l) => ({
        presentacionId: l.presentacionId,
        cantidad: l.cantidad,
        cantidadPromocion: l.cantidadPromocion,
        precio: aPesos(l.precioCentavos),
      })),
      trx,
    );

    // T-20 (D2): una venta de contado ya se cobro. Deja su fila en
    // `cobranza_abono` para que corte y tesoreria sumen una sola tabla, marcada
    // `venta_contado` para poder desglosarla. Una promocion ($0) no se cobra.
    // La venta no captura fecha de pago: es la de la operacion. El cobrador es
    // el vendedor de la venta, que en una venta de Oficina es null (T-17).
    if (venta.contadoCredito === 'contado' && monto > 0) {
      await this.cobranzas.insertarAbono(
        {
          ventaNotaId: id,
          vendedorId: contexto.vendedorId,
          fechaPago: contexto.fechaOperacion,
          fechaOperacion: contexto.fechaOperacion,
          monto: aPesos(monto),
          tipo: 'cobranza',
          saldoPendiente: aPesos(0),
          metodoPago: contexto.metodoPagoContado,
          origen: 'venta_contado',
        },
        trx,
      );
    }

    return { id, montoCentavos: monto, status };
  }
}
