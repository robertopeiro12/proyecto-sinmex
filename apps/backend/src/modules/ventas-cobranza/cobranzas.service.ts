import { Injectable } from '@nestjs/common';
import type { Transaction } from 'kysely';
import type { DB } from '../../database/schema';
import { aCentavos, aPesos } from '../sincronizacion/dinero';
import { CobranzaRechazada } from './cobranza-rechazada';
import { CobranzasRepository } from './cobranzas.repository';
import type { CobranzaNormalizada } from './datos-cobranza';
import {
  esCobrable,
  repartirPago,
  saldoDerivadoCentavos,
} from './reglas-cobranza';
import type { ContextoVenta } from './ventas.service';

/**
 * Quien y cuando: el mismo contexto que la venta (D13). Desde la tablet
 * `folio` viene emitido y `usuarioId` es null; el portal (T-21) los llenara al
 * reves.
 */
export type ContextoCobranza = ContextoVenta;

/** La fila a la que apunta el buzon (`sync_operacion.entidad_*`). */
export interface EntidadCobranza {
  tabla: 'cobranza_abono' | 'saldo_favor_movimiento';
  id: string;
}

/**
 * La cobranza (T-20): **una regla, un sitio** (ADR-0009). La tablet entra por
 * el `push`; el portal entrara por su controller en T-21, los dos por aqui.
 */
@Injectable()
export class CobranzasService {
  constructor(private readonly repo: CobranzasRepository) {}

  /**
   * Registra un cobro cuya forma ya valido `normalizarDatosCobranza`, dentro de
   * la transaccion de quien llama.
   *
   * Reparte el monto (D1): la nota elegida, las otras notas cobrables del
   * cliente por fecha y folio, y el resto a saldo a favor. Una nota elegida ya
   * pagada, cancelada o borrada no se rechaza (D9).
   *
   * Devuelve la primera fila `cobranza_abono` creada o, si todo quedo a favor,
   * el movimiento de saldo a favor.
   *
   * @throws {CobranzaRechazada} `nota-no-encontrada` (D10). No escribe nada antes de lanzar.
   */
  async registrarCobranza(
    cobranza: CobranzaNormalizada,
    contexto: ContextoCobranza,
    trx: Transaction<DB>,
  ): Promise<EntidadCobranza> {
    const nota = await this.repo.notaParaCobro(cobranza.ventaNotaId, trx);
    if (
      !nota ||
      nota.sucursalId !== contexto.sucursalId ||
      nota.clienteId !== cobranza.clienteId
    ) {
      throw new CobranzaRechazada({
        razon: 'nota-no-encontrada',
        motivo: `La nota ${cobranza.ventaNotaId} no existe o no es de este cliente.`,
      });
    }

    // D13: primero el candado, despues los saldos.
    const notas = await this.repo.bloquearNotasDelCliente(
      cobranza.clienteId,
      cobranza.ventaNotaId,
      trx,
    );
    const abonado = await this.repo.abonadoPorNota(
      notas.map((n) => n.id),
      trx,
    );

    const reparto = repartirPago(
      cobranza.montoCentavos,
      cobranza.ventaNotaId,
      notas.map((n) => ({
        id: n.id,
        fecha: n.fecha,
        folio: n.folio,
        cobrable: esCobrable(n.status, n.borrada),
        saldoCentavos: saldoDerivadoCentavos(
          aCentavos(n.montoTotal),
          aCentavos(abonado.get(n.id)),
        ),
      })),
    );

    let primera: string | null = null;
    for (const a of reparto.aplicaciones) {
      const id = await this.repo.insertarAbono(
        {
          ventaNotaId: a.notaId,
          vendedorId: contexto.vendedorId,
          fechaPago: cobranza.fechaPago,
          fechaOperacion: contexto.fechaOperacion,
          monto: aPesos(a.montoCentavos),
          tipo: a.tipo,
          // La foto del saldo tras esta fila (D7); nunca se lee como fuente.
          saldoPendiente: aPesos(a.saldoDespuesCentavos),
          metodoPago: cobranza.metodoPago,
          folio: contexto.folio,
          origen: 'cobro',
        },
        trx,
      );
      primera ??= id;
      await this.repo.actualizarStatusNota(a.notaId, a.status, trx);
    }

    let movimiento: string | null = null;
    if (reparto.saldoFavorCentavos > 0) {
      movimiento = await this.repo.insertarSaldoFavor(
        {
          clienteId: cobranza.clienteId,
          vendedorId: contexto.vendedorId,
          monto: aPesos(reparto.saldoFavorCentavos),
          folio: contexto.folio,
          fechaOperacion: contexto.fechaOperacion,
        },
        trx,
      );
    }

    if (primera !== null) return { tabla: 'cobranza_abono', id: primera };
    if (movimiento !== null)
      return { tabla: 'saldo_favor_movimiento', id: movimiento };
    // repartirPago no admite montos <= 0: si llega aqui, algo se rompio arriba.
    throw new Error('registrarCobranza no escribio ninguna fila.');
  }
}
