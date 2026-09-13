import { Injectable } from '@nestjs/common';
import type { Transaction } from 'kysely';
import type { DB } from '../../database/schema';
import { PreciosRepository } from '../cartera-clientes/precios.repository';
import { aPesos } from '../sincronizacion/dinero';
import type { VentaNormalizada } from './datos-venta';
import {
  mesDe,
  montoTotalCentavos,
  revisarLineas,
  semanaISO,
  statusInicial,
} from './reglas-venta';
import { VentaRechazada } from './venta-rechazada';
import { VentasRepository } from './ventas.repository';

/**
 * Quien y cuando (ADR-0009 §2.2, con la enmienda de T-16: sin
 * `syncOperacionId`, la trazabilidad va en `sync_operacion.entidad_*`).
 */
export interface ContextoVenta {
  /** Sucursal de la operacion. Desde la tablet, la del vendedor del token. */
  sucursalId: string;
  /** Dia de trabajo `AAAA-MM-DD` tal cual llego: de aqui salen fecha, semana, mes y precios. */
  fechaOperacion: string;
  /**
   * El repartidor de la venta. **Obligatorio siempre**: `venta_nota.vendedor_id`
   * es NOT NULL y Repartidor es obligatorio en [[Venta-Nota]], tambien en una
   * venta de oficina (T-17).
   */
  vendedorId: string;
  /** Lo emite la tablet offline. Que folio lleva una venta de oficina lo decide T-17. */
  folio: string | null;
  /** Quien la capturo en el portal (T-17). No sustituye a `vendedorId`. `null` desde la tablet. */
  usuarioId: string | null;
}

/**
 * La venta (T-16): **una regla, un sitio** (ADR-0009). La tablet entra por el
 * `push` y el portal entrara por su controller en T-17, los dos por aqui.
 */
@Injectable()
export class VentasService {
  constructor(
    private readonly repo: VentasRepository,
    private readonly precios: PreciosRepository,
  ) {}

  /**
   * Registra una venta cuya forma ya valido `normalizarDatosVenta`, dentro de
   * la transaccion de quien llama.
   *
   * No compara precios (D2): solo exige que cada presentacion se venda y que
   * las lineas con cantidad tengan algun precio vigente para el cliente a la
   * fecha de la operacion (D12, D13). El monto y el status los calcula aqui
   * (D4, D14) y congela el % de comision del cliente (D8).
   *
   * @throws {VentaRechazada} si el cliente no es de la sucursal, una
   * presentacion no se vende o falta precio. No escribe nada antes de lanzar.
   */
  async registrarVenta(
    venta: VentaNormalizada,
    contexto: ContextoVenta,
    trx: Transaction<DB>,
  ): Promise<{ id: string }> {
    // `venta_nota.folio` es NOT NULL UNIQUE. Hoy solo llama el push, que siempre
    // trae folio; llegar aqui sin el es un bug de quien llama, no una regla de
    // negocio que el vendedor pueda corregir.
    if (contexto.folio === null) {
      throw new Error(
        'registrarVenta necesita un folio; la venta de oficina sin folio la resuelve T-17.',
      );
    }

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

    const precios = await this.precios.presentacionesConPrecio(
      venta.clienteId,
      contexto.fechaOperacion,
      trx,
    );
    const rechazo = revisarLineas(venta.lineas, precios);
    if (rechazo) throw new VentaRechazada(rechazo);

    const monto = montoTotalCentavos(venta.lineas);
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
        status: statusInicial(venta.contadoCredito, monto),
        pctComision: cliente.pctComision,
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

    return { id };
  }
}
