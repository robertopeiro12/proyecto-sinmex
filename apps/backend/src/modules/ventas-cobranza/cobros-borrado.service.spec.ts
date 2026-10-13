import type { Transaction } from 'kysely';
import type { DB } from '../../database/schema';
import type { CabeceraCobro } from './cobros-borrado.repository';
import {
  CobroNoBorrable,
  CobrosBorradoService,
  MOTIVO_COBRO_BORRADO,
  MOTIVO_COBRO_NO_EXISTE,
} from './cobros-borrado.service';
import type { NotaBloqueada } from './cobranzas.repository';
import { MOTIVO_SALDO_FAVOR_APLICADO } from './reglas-borrado-cobro';

const trx = {} as Transaction<DB>;
const COBRO = 'cobro-1';
const CLIENTE = 'cliente-1';
const A = 'nota-a';
const B = 'nota-b';

const cabecera = (extra: Partial<CabeceraCobro> = {}): CabeceraCobro => ({
  id: COBRO,
  clienteId: CLIENTE,
  cliente: 'Tacos Erick',
  sucursalId: 'sucursal-tj',
  sucursalCodigo: 'TJ',
  origen: 'cobro',
  metodoPago: 'efectivo',
  monto: '1000.00',
  fechaPago: '2026-10-10',
  fechaOperacion: '2026-10-10',
  cobrador: 'Juan Perez',
  borrado: false,
  ...extra,
});

const bloqueada = (
  id: string,
  fecha: string,
  montoTotal: string,
  status = 'pagada',
): NotaBloqueada => ({
  id,
  fecha,
  folio: `TJ${fecha.slice(2, 4)}${fecha.slice(5, 7)}${fecha.slice(8, 10)}AP01`,
  numNota: null,
  status,
  borrada: false,
  montoTotal,
});

/** Pago de $1,000: $400 a A, $500 a B y $100 a saldo a favor. */
function montar(
  opciones: {
    cab?: CabeceraCobro | undefined;
    delPago?: Map<string, string>;
    abonado?: Map<string, string>;
    saldoFavor?: string[];
    movimiento?: string;
    borradoAlBloquear?: boolean;
  } = {},
) {
  const repo = {
    cabecera: jest
      .fn()
      .mockResolvedValue('cab' in opciones ? opciones.cab : cabecera()),
    delPagoPorNota: jest.fn().mockResolvedValue(
      opciones.delPago ??
        new Map([
          [A, '400.00'],
          [B, '500.00'],
        ]),
    ),
    bloquearCobro: jest
      .fn()
      .mockResolvedValue({ borrado: opciones.borradoAlBloquear ?? false }),
    movimientoDelPago: jest
      .fn()
      .mockResolvedValue(opciones.movimiento ?? '100.00'),
    borrarPago: jest.fn().mockResolvedValue(undefined),
    escribirStatusNota: jest.fn().mockResolvedValue(undefined),
    tocarCliente: jest.fn().mockResolvedValue(undefined),
  };
  const cobranzas = {
    bloquearNotasDelCliente: jest
      .fn()
      .mockResolvedValue([
        bloqueada(A, '2026-08-01', '600.00'),
        bloqueada(B, '2026-08-03', '500.00'),
      ]),
    abonadoPorNota: jest.fn().mockResolvedValue(
      opciones.abonado ??
        new Map([
          [A, '600.00'],
          [B, '500.00'],
        ]),
    ),
    bloquearSaldoFavor: jest
      .fn()
      .mockResolvedValue(opciones.saldoFavor ?? ['300.00']),
  };
  const servicio = new CobrosBorradoService(repo as never, cobranzas as never);
  return { servicio, repo, cobranzas };
}

describe('CobrosBorradoService.planear', () => {
  it('cada nota vuelve a deber lo que le abono el pago, y el saldo a favor baja el excedente', async () => {
    const { servicio } = montar();
    await expect(servicio.planear(COBRO, trx)).resolves.toEqual({
      cobro: {
        id: COBRO,
        clienteId: CLIENTE,
        cliente: 'Tacos Erick',
        sucursalCodigo: 'TJ',
        origen: 'cobro',
        metodoPago: 'efectivo',
        montoCentavos: 100000,
        fechaPago: '2026-10-10',
        fechaOperacion: '2026-10-10',
        cobrador: 'Juan Perez',
      },
      notas: [
        {
          notaId: A,
          folio: 'TJ260801AP01',
          numNota: null,
          fecha: '2026-08-01',
          delPagoCentavos: 40000,
          saldoAntesCentavos: 0,
          saldoDespuesCentavos: 40000,
          statusDespues: 'abonado',
        },
        {
          notaId: B,
          folio: 'TJ260803AP01',
          numNota: null,
          fecha: '2026-08-03',
          delPagoCentavos: 50000,
          saldoAntesCentavos: 0,
          saldoDespuesCentavos: 50000,
          statusDespues: 'pendiente',
        },
      ],
      saldoFavorAntesCentavos: 30000,
      saldoFavorDespuesCentavos: 20000,
      movimientoSaldoFavorCentavos: 10000,
      bloqueo: null,
    });
  });

  it('Review Focus 1: candados en el orden del cobro — notas, saldo a favor, pago — y lo del pago se relee despues', async () => {
    const { servicio, repo, cobranzas } = montar();
    await servicio.planear(COBRO, trx);

    expect(cobranzas.bloquearNotasDelCliente).toHaveBeenCalledWith(
      CLIENTE,
      [A, B],
      trx,
    );
    const orden = [
      cobranzas.bloquearNotasDelCliente.mock.invocationCallOrder[0],
      cobranzas.abonadoPorNota.mock.invocationCallOrder[0],
      cobranzas.bloquearSaldoFavor.mock.invocationCallOrder[0],
      repo.bloquearCobro.mock.invocationCallOrder[0],
      repo.movimientoDelPago.mock.invocationCallOrder[0],
    ];
    expect([...orden].sort((x, y) => x - y)).toEqual(orden);
    // La segunda lectura de lo del pago va despues del candado del pago.
    expect(repo.delPagoPorNota.mock.invocationCallOrder[1]).toBeGreaterThan(
      repo.bloquearCobro.mock.invocationCallOrder[0],
    );
  });

  it('un pago que solo dejo saldo a favor igual bloquea las notas del cliente (mismo orden de candados)', async () => {
    const { servicio, cobranzas } = montar({ delPago: new Map() });
    const vista = await servicio.planear(COBRO, trx);
    expect(cobranzas.bloquearNotasDelCliente).toHaveBeenCalledWith(
      CLIENTE,
      [],
      trx,
    );
    expect(vista.notas).toEqual([]);
  });

  it('un pago que no existe es no-existe', async () => {
    const { servicio, cobranzas } = montar({ cab: undefined });
    await expect(servicio.planear(COBRO, trx)).rejects.toMatchObject({
      razon: 'no-existe',
      message: MOTIVO_COBRO_NO_EXISTE,
    });
    expect(cobranzas.bloquearNotasDelCliente).not.toHaveBeenCalled();
  });

  it('un pago que resulto borrado al tomar su candado es cobro-borrado', async () => {
    const { servicio } = montar({ borradoAlBloquear: true });
    const error = await servicio.planear(COBRO, trx).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CobroNoBorrable);
    expect(error).toMatchObject({
      razon: 'cobro-borrado',
      message: MOTIVO_COBRO_BORRADO,
    });
  });

  it('el bloqueo de saldo a favor ya aplicado viaja en la vista (no lanza)', async () => {
    const { servicio } = montar({ saldoFavor: ['100.00', '-60.00'] });
    const vista = await servicio.planear(COBRO, trx);
    expect(vista.saldoFavorDespuesCentavos).toBe(-6000);
    expect(vista.bloqueo).toEqual({
      codigo: 'saldo-favor-aplicado',
      motivo: MOTIVO_SALDO_FAVOR_APLICADO,
    });
  });
});

describe('CobrosBorradoService.borrar', () => {
  it('borra el pago completo, escribe el status de cada nota y toca al cliente por el saldo a favor', async () => {
    const { servicio, repo } = montar();
    const vista = await servicio.borrar(COBRO, 'usuario-1', trx);

    expect(repo.borrarPago).toHaveBeenCalledWith(COBRO, 'usuario-1', trx);
    expect(repo.escribirStatusNota).toHaveBeenCalledTimes(2);
    expect(repo.escribirStatusNota).toHaveBeenCalledWith(A, 'abonado', trx);
    expect(repo.escribirStatusNota).toHaveBeenCalledWith(B, 'pendiente', trx);
    expect(repo.tocarCliente).toHaveBeenCalledWith(CLIENTE, trx);
    expect(vista.saldoFavorDespuesCentavos).toBe(20000);
  });

  it('borrar una aplicacion de saldo a favor tambien toca al cliente (su saldo sube)', async () => {
    const { servicio, repo } = montar({
      cab: cabecera({
        origen: 'saldo_favor',
        metodoPago: 'saldo_favor',
        cobrador: null,
      }),
      delPago: new Map([[A, '30.00']]),
      abonado: new Map([[A, '30.00']]),
      movimiento: '-30.00',
      saldoFavor: ['20.00'],
    });
    const vista = await servicio.borrar(COBRO, 'usuario-1', trx);
    expect(vista.saldoFavorDespuesCentavos).toBe(5000);
    expect(repo.tocarCliente).toHaveBeenCalledWith(CLIENTE, trx);
  });

  it('un pago sin movimiento de saldo a favor no toca al cliente', async () => {
    const { servicio, repo } = montar({ movimiento: '0' });
    await servicio.borrar(COBRO, 'usuario-1', trx);
    expect(repo.tocarCliente).not.toHaveBeenCalled();
  });

  it('Review Focus 1: con el saldo a favor ya aplicado lanza y no escribe nada', async () => {
    const { servicio, repo } = montar({ saldoFavor: ['50.00'] });
    await expect(
      servicio.borrar(COBRO, 'usuario-1', trx),
    ).rejects.toMatchObject({
      razon: 'saldo-favor-aplicado',
      message: MOTIVO_SALDO_FAVOR_APLICADO,
    });
    expect(repo.borrarPago).not.toHaveBeenCalled();
    expect(repo.escribirStatusNota).not.toHaveBeenCalled();
    expect(repo.tocarCliente).not.toHaveBeenCalled();
  });

  it('un pago ya borrado no se vuelve a borrar', async () => {
    const { servicio, repo } = montar({ borradoAlBloquear: true });
    await expect(
      servicio.borrar(COBRO, 'usuario-1', trx),
    ).rejects.toMatchObject({
      razon: 'cobro-borrado',
    });
    expect(repo.borrarPago).not.toHaveBeenCalled();
  });
});
