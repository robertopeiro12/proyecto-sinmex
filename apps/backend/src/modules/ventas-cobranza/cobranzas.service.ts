import { Injectable } from '@nestjs/common';
import type { Transaction } from 'kysely';
import type { DB } from '../../database/schema';
import { aCentavos, aPesos } from '../sincronizacion/dinero';
import { CobranzaRechazada } from './cobranza-rechazada';
import {
  CobranzasRepository,
  type MetodoAbono,
  type NotaBloqueada,
} from './cobranzas.repository';
import type { CobranzaNormalizada, MetodoPago } from './datos-cobranza';
import {
  MOTIVO_NOTA_AJENA,
  PagoRechazado,
  motivoExcedeLoQueDeben,
  motivoFechaAnterior,
  motivoNotaSinSaldo,
  motivoSaldoFavorInsuficiente,
} from './pago-rechazado';
import {
  esCobrable,
  repartirPagoEnNotas,
  saldoDerivadoCentavos,
  type NotaParaReparto,
  type Reparto,
} from './reglas-cobranza';

/**
 * Quien y cuando (D13). **Sin folio**: la cobranza no lleva folio (cliente,
 * 2026-10-07).
 *
 * - Tablet: `vendedorId` es el de la sesion y `usuarioId` null.
 * - Portal (T-21): `vendedorId` es el cobrador elegido (`null` = Oficina) y
 *   `usuarioId` quien capturo.
 */
export interface ContextoCobranza {
  sucursalId: string;
  fechaOperacion: string;
  vendedorId: string | null;
  usuarioId: string | null;
}

/** La fila a la que apunta el buzon (`sync_operacion.entidad_*`). */
export interface EntidadCobranza {
  tabla: 'cobranza_abono' | 'saldo_favor_movimiento';
  id: string;
}

/** Las notas que palomeo la oficina y cuanto (T-21). Sin repetir, en minusculas. */
export interface NotasAPagar {
  clienteId: string;
  notaIds: string[];
  montoCentavos: number;
}

/** Un pago del portal: las notas y el monto, mas como y cuando se pago. */
export interface PagoEnNotas extends NotasAPagar {
  metodoPago: MetodoPago;
  fechaPago: string;
}

/** Lo que el pago deja en una nota, con lo necesario para pintarlo (T-21). */
export interface AplicacionDeCobro {
  notaId: string;
  folio: string;
  numNota: string | null;
  fecha: string;
  montoCentavos: number;
  saldoAntesCentavos: number;
  saldoDespuesCentavos: number;
  status: 'pagada' | 'abonado';
  /** `true` si la oficina la palomeo; `false` si le toco del excedente. */
  palomeada: boolean;
}

/** La vista previa y lo que se grabo: el mismo calculo (§3.3). */
export interface PlanDeCobro {
  aplicaciones: AplicacionDeCobro[];
  /** Lo que iria (o fue) a saldo a favor. Siempre 0 al aplicar saldo a favor. */
  saldoFavorCentavos: number;
}

/** Las notas del cliente ya bloqueadas, con su saldo derivado (D7). */
interface NotasConSaldo {
  bloqueadas: NotaBloqueada[];
  paraReparto: NotaParaReparto[];
}

/** Una palomeada ya comprobada sobre la fila bloqueada. */
interface Palomeada {
  nota: NotaBloqueada;
  saldoCentavos: number;
}

/** Como se escriben las filas de un reparto. */
interface FormaDelAbono {
  fechaPago: string;
  metodoPago: MetodoAbono;
  origen: 'cobro' | 'saldo_favor';
}

/**
 * La cobranza: **una regla, un sitio** (ADR-0009). La tablet entra por el
 * `push` con una nota (`registrarCobranza`); el portal (T-21) entra por
 * `CobranzasPortalService` con una o varias (`registrarPago`,
 * `aplicarSaldoFavor`). Las dos rutas reparten con `repartirPagoEnNotas` y
 * escriben con `escribir`.
 */
@Injectable()
export class CobranzasService {
  constructor(private readonly repo: CobranzasRepository) {}

  /**
   * Registra un cobro de la tablet cuya forma ya valido
   * `normalizarDatosCobranza`, dentro de la transaccion de quien llama.
   *
   * Reparte el monto (D1): la nota elegida, las otras notas cobrables del
   * cliente por fecha y folio, y el resto a saldo a favor. Una nota elegida ya
   * pagada, de cuenta perdida o borrada no se rechaza (D9).
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

    const notaIds = [cobranza.ventaNotaId];
    // D13: primero el candado, despues los saldos.
    const { paraReparto } = await this.bloquear(
      cobranza.clienteId,
      notaIds,
      trx,
    );
    const reparto = repartirPagoEnNotas(
      cobranza.montoCentavos,
      notaIds,
      paraReparto,
    );
    const entidad = await this.escribir(
      reparto,
      cobranza.clienteId,
      {
        fechaPago: cobranza.fechaPago,
        metodoPago: cobranza.metodoPago,
        origen: 'cobro',
      },
      contexto,
      trx,
    );
    // repartirPagoEnNotas no admite montos <= 0: si llega aqui, algo se rompio arriba.
    if (entidad === null)
      throw new Error('registrarCobranza no escribio ninguna fila.');
    return entidad;
  }

  /**
   * La vista previa de un pago del portal (§3.3): mismas notas bloqueadas, mismas
   * comprobaciones y mismo reparto que `registrarPago`, sin escribir nada.
   *
   * @throws {PagoRechazado} `nota-ajena` o `nota-sin-saldo`.
   */
  async planearPago(
    pago: NotasAPagar,
    trx: Transaction<DB>,
  ): Promise<PlanDeCobro> {
    const notas = await this.bloquear(pago.clienteId, pago.notaIds, trx);
    this.exigirPalomeadas(pago.notaIds, notas);
    return this.plan(
      repartirPagoEnNotas(pago.montoCentavos, pago.notaIds, notas.paraReparto),
      notas.bloqueadas,
      pago.notaIds,
    );
  }

  /**
   * Registra un pago del portal sobre una o varias notas (T-21). A diferencia
   * de la tablet, una palomeada que ya no tiene saldo SI se rechaza: la oficina
   * tiene la pantalla enfrente y vuelve a cargar. Se decide sobre las filas
   * bloqueadas, nunca sobre lo que la pantalla leyo antes (lección de T-19).
   *
   * @throws {PagoRechazado} `nota-ajena`, `nota-sin-saldo` o `fecha-anterior`.
   * No escribe nada antes de lanzar.
   */
  async registrarPago(
    pago: PagoEnNotas,
    contexto: ContextoCobranza,
    trx: Transaction<DB>,
  ): Promise<PlanDeCobro> {
    const notas = await this.bloquear(pago.clienteId, pago.notaIds, trx);
    const palomeadas = this.exigirPalomeadas(pago.notaIds, notas);

    const masVieja = palomeadas.map((p) => p.nota.fecha).sort()[0];
    if (masVieja !== undefined && pago.fechaPago < masVieja) {
      throw new PagoRechazado('fecha-anterior', motivoFechaAnterior(masVieja));
    }

    const reparto = repartirPagoEnNotas(
      pago.montoCentavos,
      pago.notaIds,
      notas.paraReparto,
    );
    await this.escribir(
      reparto,
      pago.clienteId,
      {
        fechaPago: pago.fechaPago,
        metodoPago: pago.metodoPago,
        origen: 'cobro',
      },
      contexto,
      trx,
    );
    return this.plan(reparto, notas.bloqueadas, pago.notaIds);
  }

  /**
   * La vista previa de aplicar saldo a favor: mismas comprobaciones y mismo
   * reparto que `aplicarSaldoFavor`, sin escribir nada.
   *
   * @throws {PagoRechazado} `nota-ajena`, `nota-sin-saldo`,
   * `saldo-favor-insuficiente` o `excede-lo-que-deben`.
   */
  async planearSaldoFavor(
    pago: NotasAPagar,
    trx: Transaction<DB>,
  ): Promise<PlanDeCobro> {
    const { reparto, bloqueadas } = await this.repartirSaldoFavor(pago, trx);
    return this.plan(reparto, bloqueadas, pago.notaIds);
  }

  /**
   * Aplica saldo a favor a las palomeadas (§3.4). No es dinero nuevo: las filas
   * llevan metodo y origen `saldo_favor` y sin cobrador, el dia es el de hoy, y
   * el libro de saldo a favor gana un movimiento NEGATIVO `aplicacion`. Sin
   * excedente: lo que no deban las palomeadas no se mueve.
   *
   * @throws {PagoRechazado} como `planearSaldoFavor`. No escribe nada antes de lanzar.
   */
  async aplicarSaldoFavor(
    pago: NotasAPagar,
    contexto: ContextoCobranza,
    trx: Transaction<DB>,
  ): Promise<PlanDeCobro> {
    const { reparto, bloqueadas } = await this.repartirSaldoFavor(pago, trx);
    await this.escribir(
      reparto,
      pago.clienteId,
      {
        fechaPago: contexto.fechaOperacion,
        metodoPago: 'saldo_favor',
        origen: 'saldo_favor',
      },
      contexto,
      trx,
    );
    await this.repo.insertarSaldoFavor(
      {
        clienteId: pago.clienteId,
        vendedorId: null,
        monto: aPesos(-pago.montoCentavos),
        origen: 'aplicacion',
        fechaOperacion: contexto.fechaOperacion,
        capturoUsuarioId: contexto.usuarioId,
      },
      trx,
    );
    return this.plan(reparto, bloqueadas, pago.notaIds);
  }

  /* ---------------------------------------------------------------- */

  /** D13: primero el candado de las notas, despues lo abonado. */
  private async bloquear(
    clienteId: string,
    notaIds: readonly string[],
    trx: Transaction<DB>,
  ): Promise<NotasConSaldo> {
    const bloqueadas = await this.repo.bloquearNotasDelCliente(
      clienteId,
      notaIds,
      trx,
    );
    const abonado = await this.repo.abonadoPorNota(
      bloqueadas.map((n) => n.id),
      trx,
    );
    return {
      bloqueadas,
      paraReparto: bloqueadas.map((n) => ({
        id: n.id,
        fecha: n.fecha,
        folio: n.folio,
        cobrable: esCobrable(n.status, n.borrada),
        saldoCentavos: saldoDerivadoCentavos(
          aCentavos(n.montoTotal),
          aCentavos(abonado.get(n.id)),
        ),
      })),
    };
  }

  /** Cada palomeada tiene que estar entre las bloqueadas, cobrable y con saldo. */
  private exigirPalomeadas(
    notaIds: readonly string[],
    { bloqueadas, paraReparto }: NotasConSaldo,
  ): Palomeada[] {
    const porId = new Map(bloqueadas.map((n) => [n.id, n]));
    const saldos = new Map(paraReparto.map((n) => [n.id, n]));
    return notaIds.map((id) => {
      const nota = porId.get(id);
      const reparto = saldos.get(id);
      if (!nota || !reparto)
        throw new PagoRechazado('nota-ajena', MOTIVO_NOTA_AJENA);
      if (!reparto.cobrable || reparto.saldoCentavos <= 0)
        throw new PagoRechazado(
          'nota-sin-saldo',
          motivoNotaSinSaldo(nota.folio),
        );
      return { nota, saldoCentavos: reparto.saldoCentavos };
    });
  }

  /** Bloquea notas y saldo a favor (en ese orden), valida y reparte solo entre las palomeadas. */
  private async repartirSaldoFavor(
    pago: NotasAPagar,
    trx: Transaction<DB>,
  ): Promise<{ reparto: Reparto; bloqueadas: NotaBloqueada[] }> {
    const notas = await this.bloquear(pago.clienteId, pago.notaIds, trx);
    const palomeadas = this.exigirPalomeadas(pago.notaIds, notas);

    const disponible = (
      await this.repo.bloquearSaldoFavor(pago.clienteId, trx)
    ).reduce((total, monto) => total + aCentavos(monto), 0);
    if (pago.montoCentavos > disponible) {
      throw new PagoRechazado(
        'saldo-favor-insuficiente',
        motivoSaldoFavorInsuficiente(Math.max(0, disponible)),
      );
    }

    const deben = palomeadas.reduce((t, p) => t + p.saldoCentavos, 0);
    if (pago.montoCentavos > deben) {
      throw new PagoRechazado(
        'excede-lo-que-deben',
        motivoExcedeLoQueDeben(deben),
      );
    }

    const elegidas = new Set(pago.notaIds);
    const reparto = repartirPagoEnNotas(
      pago.montoCentavos,
      pago.notaIds,
      notas.paraReparto.filter((n) => elegidas.has(n.id)),
    );
    return { reparto, bloqueadas: notas.bloqueadas };
  }

  /**
   * Las filas `cobranza_abono` del reparto, el status de cada nota (se escribe
   * aunque no cambie: el trigger le toca `updated_at` y el pull la ve, D12) y,
   * si sobra, el excedente a saldo a favor. Devuelve la primera fila escrita.
   */
  private async escribir(
    reparto: Reparto,
    clienteId: string,
    forma: FormaDelAbono,
    contexto: ContextoCobranza,
    trx: Transaction<DB>,
  ): Promise<EntidadCobranza | null> {
    let primera: string | null = null;
    for (const a of reparto.aplicaciones) {
      const id = await this.repo.insertarAbono(
        {
          ventaNotaId: a.notaId,
          vendedorId: contexto.vendedorId,
          fechaPago: forma.fechaPago,
          fechaOperacion: contexto.fechaOperacion,
          monto: aPesos(a.montoCentavos),
          tipo: a.tipo,
          // La foto del saldo tras esta fila (D7); nunca se lee como fuente.
          saldoPendiente: aPesos(a.saldoDespuesCentavos),
          metodoPago: forma.metodoPago,
          origen: forma.origen,
          capturoUsuarioId: contexto.usuarioId,
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
          clienteId,
          vendedorId: contexto.vendedorId,
          monto: aPesos(reparto.saldoFavorCentavos),
          origen: 'excedente_cobro',
          fechaOperacion: contexto.fechaOperacion,
          capturoUsuarioId: contexto.usuarioId,
        },
        trx,
      );
    }

    if (primera !== null) return { tabla: 'cobranza_abono', id: primera };
    if (movimiento !== null)
      return { tabla: 'saldo_favor_movimiento', id: movimiento };
    return null;
  }

  /** El reparto con folio, # de nota y fecha de cada nota, para la pantalla. */
  private plan(
    reparto: Reparto,
    bloqueadas: NotaBloqueada[],
    notaIds: readonly string[],
  ): PlanDeCobro {
    const porId = new Map(bloqueadas.map((n) => [n.id, n]));
    const elegidas = new Set(notaIds);
    return {
      aplicaciones: reparto.aplicaciones.map((a) => {
        const nota = porId.get(a.notaId);
        return {
          notaId: a.notaId,
          folio: nota?.folio ?? a.notaId,
          numNota: nota?.numNota ?? null,
          fecha: nota?.fecha ?? '',
          montoCentavos: a.montoCentavos,
          saldoAntesCentavos: a.saldoAntesCentavos,
          saldoDespuesCentavos: a.saldoDespuesCentavos,
          status: a.status,
          palomeada: elegidas.has(a.notaId),
        };
      }),
      saldoFavorCentavos: reparto.saldoFavorCentavos,
    };
  }
}
