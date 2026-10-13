import { Injectable } from '@nestjs/common';
import type { Transaction } from 'kysely';
import type { DB } from '../../database/schema';
import { aCentavos } from '../sincronizacion/dinero';
import {
  CobrosBorradoRepository,
  type CabeceraCobro,
} from './cobros-borrado.repository';
import { CobranzasRepository } from './cobranzas.repository';
import {
  planearBorrado,
  type BloqueoBorrado,
  type NotaTrasBorrar,
} from './reglas-borrado-cobro';

export const MOTIVO_COBRO_NO_EXISTE = 'No existe ese cobro.';
export const MOTIVO_COBRO_BORRADO = 'Este cobro ya se borró.';

export type RazonNoBorrable =
  'no-existe' | 'cobro-borrado' | 'saldo-favor-aplicado';

/** Un pago que no se puede borrar (o ver) ahora. Quien llama lo traduce a HTTP. */
export class CobroNoBorrable extends Error {
  constructor(
    readonly razon: RazonNoBorrable,
    mensaje: string,
  ) {
    super(mensaje);
    this.name = 'CobroNoBorrable';
  }
}

/** El pago, listo para la pantalla: dinero en centavos. */
export interface CobroEnVista {
  id: string;
  clienteId: string;
  cliente: string;
  sucursalCodigo: string;
  origen: 'cobro' | 'saldo_favor';
  metodoPago: string;
  montoCentavos: number;
  fechaPago: string;
  fechaOperacion: string;
  /** `null` = Oficina (o saldo a favor). */
  cobrador: string | null;
}

/** `GET /cobros/:id/vista-borrado` y `GET /peticiones/:id/vista-previa` (§3.1). */
export interface VistaBorrado {
  cobro: CobroEnVista;
  notas: NotaTrasBorrar[];
  saldoFavorAntesCentavos: number;
  saldoFavorDespuesCentavos: number;
  /** El movimiento del pago: + excedente, - aplicacion, 0 si no movio saldo a favor. */
  movimientoSaldoFavorCentavos: number;
  bloqueo: BloqueoBorrado | null;
}

const enVista = (c: CabeceraCobro): CobroEnVista => ({
  id: c.id,
  clienteId: c.clienteId,
  cliente: c.cliente,
  sucursalCodigo: c.sucursalCodigo,
  origen: c.origen,
  metodoPago: c.metodoPago,
  montoCentavos: aCentavos(c.monto),
  fechaPago: c.fechaPago,
  fechaOperacion: c.fechaOperacion,
  cobrador: c.cobrador,
});

/**
 * Borrar un pago completo (T-34). No sabe de peticiones, permisos ni alcance:
 * `PeticionesService` exige el alcance con `cabecera` antes de llamarlo.
 *
 * Candados en el MISMO orden que el cobro (T-20/T-21): las notas del cliente
 * (`bloquearNotasDelCliente`, en orden de id), su saldo a favor, y al final la
 * fila del pago. Un cobro de la tablet o del portal sobre el mismo cliente se
 * serializa con el borrado, sin abrazo mortal; las decisiones se toman sobre lo
 * bloqueado, nunca sobre lo que leyo la pantalla (leccion de T-19).
 */
@Injectable()
export class CobrosBorradoService {
  constructor(
    private readonly repo: CobrosBorradoRepository,
    private readonly cobranzas: CobranzasRepository,
  ) {}

  /**
   * Toma los candados y dice que pasaria. No escribe nada. El bloqueo (saldo a
   * favor ya aplicado) viaja en la vista, no se lanza: la pantalla lo muestra.
   *
   * @throws {CobroNoBorrable} `no-existe` o `cobro-borrado`.
   */
  async planear(cobroId: string, trx: Transaction<DB>): Promise<VistaBorrado> {
    const cabecera = await this.repo.cabecera(cobroId, trx);
    if (!cabecera)
      throw new CobroNoBorrable('no-existe', MOTIVO_COBRO_NO_EXISTE);

    // Las notas de un pago no cambian nunca (sus filas se escriben al cobrar),
    // asi que se pueden leer antes del candado para saber cuales bloquear.
    const notaIds = [...(await this.repo.delPagoPorNota(cobroId, trx)).keys()];
    const bloqueadas = await this.cobranzas.bloquearNotasDelCliente(
      cabecera.clienteId,
      notaIds,
      trx,
    );
    const abonado = await this.cobranzas.abonadoPorNota(notaIds, trx);
    const saldoFavorVivo = (
      await this.cobranzas.bloquearSaldoFavor(cabecera.clienteId, trx)
    ).reduce((total, monto) => total + aCentavos(monto), 0);

    if ((await this.repo.bloquearCobro(cobroId, trx)).borrado)
      throw new CobroNoBorrable('cobro-borrado', MOTIVO_COBRO_BORRADO);

    // Ya con el pago bloqueado: lo suyo, releido.
    const delPago = await this.repo.delPagoPorNota(cobroId, trx);
    const movimiento = aCentavos(
      await this.repo.movimientoDelPago(cobroId, trx),
    );

    const porId = new Map(bloqueadas.map((n) => [n.id, n]));
    const plan = planearBorrado({
      notas: [...delPago].map(([id, monto]) => {
        const nota = porId.get(id);
        // Imposible por construccion: el pago y sus notas son del mismo cliente.
        if (!nota)
          throw new Error(
            `La nota ${id} del cobro ${cobroId} no es de su cliente.`,
          );
        return {
          id,
          folio: nota.folio,
          numNota: nota.numNota,
          fecha: nota.fecha,
          status: nota.status,
          montoTotalCentavos: aCentavos(nota.montoTotal),
          abonadoVivoCentavos: aCentavos(abonado.get(id)),
          delPagoCentavos: aCentavos(monto),
        };
      }),
      saldoFavorVivoCentavos: saldoFavorVivo,
      movimientoDelPagoCentavos: movimiento,
    });

    return {
      cobro: enVista(cabecera),
      ...plan,
      movimientoSaldoFavorCentavos: movimiento,
    };
  }

  /**
   * Borra el pago completo dentro de la transaccion de quien llama: el
   * `cobro`, sus filas en notas y su saldo a favor (`deleted_at`), el status de
   * cada nota y, si movio saldo a favor, el `updated_at` del cliente (pull).
   *
   * @throws {CobroNoBorrable} `no-existe`, `cobro-borrado` o
   * `saldo-favor-aplicado`. No escribe nada antes de lanzar.
   */
  async borrar(
    cobroId: string,
    usuarioId: string,
    trx: Transaction<DB>,
  ): Promise<VistaBorrado> {
    const vista = await this.planear(cobroId, trx);
    if (vista.bloqueo)
      throw new CobroNoBorrable('saldo-favor-aplicado', vista.bloqueo.motivo);

    await this.repo.borrarPago(cobroId, usuarioId, trx);
    for (const nota of vista.notas)
      await this.repo.escribirStatusNota(nota.notaId, nota.statusDespues, trx);
    if (vista.movimientoSaldoFavorCentavos !== 0)
      await this.repo.tocarCliente(vista.cobro.clienteId, trx);
    return vista;
  }
}
