import type { Transaction } from 'kysely';
import type { DB } from '../../database/schema';
import type { CobranzaNormalizada } from './datos-cobranza';
import { CobranzaRechazada } from './cobranza-rechazada';
import type { NotaBloqueada, NotaParaCobro } from './cobranzas.repository';
import { CobranzasService, type ContextoCobranza } from './cobranzas.service';

const CLIENTE = 'cliente-1';
const SUCURSAL = 'sucursal-tj';
const A = 'nota-a';
const B = 'nota-b';
const C = 'nota-c';

/** El servicio no usa la transaccion: solo la pasa a quien escribe. */
const trx = {} as Transaction<DB>;

const contexto: ContextoCobranza = {
  sucursalId: SUCURSAL,
  fechaOperacion: '2026-09-14',
  vendedorId: 'vendedor-1',
  folio: 'TJ260914AP04',
  usuarioId: null,
};

const cobro = (
  extra: Partial<CobranzaNormalizada> = {},
): CobranzaNormalizada => ({
  clienteId: CLIENTE,
  ventaNotaId: A,
  montoCentavos: 5000,
  metodoPago: 'efectivo',
  fechaPago: '2026-09-10',
  ...extra,
});

const bloqueada = (
  id: string,
  fecha: string,
  montoTotal: string,
  extra: Partial<NotaBloqueada> = {},
): NotaBloqueada => ({
  id,
  fecha,
  folio: `TJ${fecha.slice(2, 4)}${fecha.slice(5, 7)}${fecha.slice(8, 10)}AP01`,
  status: 'pendiente',
  borrada: false,
  montoTotal,
  ...extra,
});

function montar(
  opciones: {
    nota?: NotaParaCobro | undefined;
    bloqueadas?: NotaBloqueada[];
    abonado?: Map<string, string>;
  } = {},
) {
  let abonos = 0;
  const repo = {
    notaParaCobro: jest
      .fn()
      .mockResolvedValue(
        'nota' in opciones
          ? opciones.nota
          : { id: A, clienteId: CLIENTE, sucursalId: SUCURSAL },
      ),
    bloquearNotasDelCliente: jest
      .fn()
      .mockResolvedValue(
        opciones.bloqueadas ?? [bloqueada(A, '2026-08-01', '250.00')],
      ),
    abonadoPorNota: jest
      .fn()
      .mockResolvedValue(opciones.abonado ?? new Map([[A, '100.00']])),
    insertarAbono: jest
      .fn()
      .mockImplementation(() => Promise.resolve(`abono-${++abonos}`)),
    actualizarStatusNota: jest.fn().mockResolvedValue(undefined),
    insertarSaldoFavor: jest.fn().mockResolvedValue('favor-1'),
  };
  const servicio = new CobranzasService(repo);
  return { servicio, repo };
}

describe('CobranzasService.registrarCobranza', () => {
  it('un abono parcial deja una fila abono con la foto del saldo y la nota abonado', async () => {
    const { servicio, repo } = montar();

    await expect(
      servicio.registrarCobranza(cobro(), contexto, trx),
    ).resolves.toEqual({
      tabla: 'cobranza_abono',
      id: 'abono-1',
    });

    expect(repo.insertarAbono).toHaveBeenCalledTimes(1);
    expect(repo.insertarAbono).toHaveBeenCalledWith(
      {
        ventaNotaId: A,
        vendedorId: 'vendedor-1',
        fechaPago: '2026-09-10',
        fechaOperacion: '2026-09-14',
        monto: '50.00',
        tipo: 'abono',
        saldoPendiente: '100.00',
        metodoPago: 'efectivo',
        folio: 'TJ260914AP04',
        origen: 'cobro',
      },
      trx,
    );
    expect(repo.actualizarStatusNota).toHaveBeenCalledWith(A, 'abonado', trx);
    expect(repo.insertarSaldoFavor).not.toHaveBeenCalled();
  });

  it('liquidar deja la fila tipo cobranza con saldo 0 y la nota pagada', async () => {
    const { servicio, repo } = montar();
    await servicio.registrarCobranza(
      cobro({ montoCentavos: 15000 }),
      contexto,
      trx,
    );

    expect(repo.insertarAbono).toHaveBeenCalledWith(
      expect.objectContaining({
        monto: '150.00',
        tipo: 'cobranza',
        saldoPendiente: '0.00',
      }),
      trx,
    );
    expect(repo.actualizarStatusNota).toHaveBeenCalledWith(A, 'pagada', trx);
  });

  it('el excedente va a las otras notas por fecha y el resto a saldo a favor, con el mismo folio', async () => {
    const { servicio, repo } = montar({
      bloqueadas: [
        bloqueada(A, '2026-08-05', '100.00'),
        bloqueada(B, '2026-08-03', '80.00'),
        bloqueada(C, '2026-08-01', '50.00', { status: 'abonado' }),
      ],
      abonado: new Map([[C, '20.00']]),
    });

    await expect(
      servicio.registrarCobranza(
        cobro({ montoCentavos: 25000 }),
        contexto,
        trx,
      ),
    ).resolves.toEqual({ tabla: 'cobranza_abono', id: 'abono-1' });

    // A (elegida) 100, luego C (la mas vieja, saldo 30) y B (80): sobran 40.
    expect(repo.insertarAbono).toHaveBeenCalledTimes(3);
    expect(repo.insertarAbono).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        ventaNotaId: A,
        monto: '100.00',
        folio: 'TJ260914AP04',
      }),
      trx,
    );
    expect(repo.insertarAbono).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        ventaNotaId: C,
        monto: '30.00',
        folio: 'TJ260914AP04',
      }),
      trx,
    );
    expect(repo.insertarAbono).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        ventaNotaId: B,
        monto: '80.00',
        folio: 'TJ260914AP04',
      }),
      trx,
    );
    expect(repo.insertarSaldoFavor).toHaveBeenCalledWith(
      {
        clienteId: CLIENTE,
        vendedorId: 'vendedor-1',
        monto: '40.00',
        folio: 'TJ260914AP04',
        fechaOperacion: '2026-09-14',
      },
      trx,
    );
  });

  it('una nota elegida ya pagada no se rechaza: el dinero va a las demas (D9)', async () => {
    const { servicio, repo } = montar({
      bloqueadas: [
        bloqueada(A, '2026-08-01', '250.00', { status: 'pagada' }),
        bloqueada(B, '2026-08-02', '60.00'),
      ],
      abonado: new Map([[A, '250.00']]),
    });

    await expect(
      servicio.registrarCobranza(
        cobro({ montoCentavos: 10000 }),
        contexto,
        trx,
      ),
    ).resolves.toEqual({ tabla: 'cobranza_abono', id: 'abono-1' });

    expect(repo.insertarAbono).toHaveBeenCalledTimes(1);
    expect(repo.insertarAbono).toHaveBeenCalledWith(
      expect.objectContaining({
        ventaNotaId: B,
        monto: '60.00',
        tipo: 'cobranza',
      }),
      trx,
    );
    expect(repo.actualizarStatusNota).not.toHaveBeenCalledWith(
      A,
      expect.anything(),
      trx,
    );
    expect(repo.insertarSaldoFavor).toHaveBeenCalledWith(
      expect.objectContaining({ monto: '40.00' }),
      trx,
    );
  });

  it('una nota elegida borrada tampoco recibe dinero, aunque diga pendiente', async () => {
    const { servicio, repo } = montar({
      bloqueadas: [bloqueada(A, '2026-08-01', '250.00', { borrada: true })],
      abonado: new Map(),
    });

    await servicio.registrarCobranza(cobro(), contexto, trx);

    expect(repo.insertarAbono).not.toHaveBeenCalled();
    expect(repo.insertarSaldoFavor).toHaveBeenCalledWith(
      expect.objectContaining({ monto: '50.00' }),
      trx,
    );
  });

  it('si todo queda a favor, el buzon apunta al movimiento de saldo a favor', async () => {
    const { servicio } = montar({
      bloqueadas: [bloqueada(A, '2026-08-01', '250.00', { status: 'pagada' })],
      abonado: new Map([[A, '250.00']]),
    });

    await expect(
      servicio.registrarCobranza(cobro(), contexto, trx),
    ).resolves.toEqual({
      tabla: 'saldo_favor_movimiento',
      id: 'favor-1',
    });
  });

  it('bloquea las notas del cliente antes de leer lo abonado (D13)', async () => {
    const { servicio, repo } = montar();
    await servicio.registrarCobranza(cobro(), contexto, trx);

    expect(repo.bloquearNotasDelCliente).toHaveBeenCalledWith(CLIENTE, A, trx);
    expect(repo.abonadoPorNota).toHaveBeenCalledWith([A], trx);
    expect(
      repo.bloquearNotasDelCliente.mock.invocationCallOrder[0],
    ).toBeLessThan(repo.abonadoPorNota.mock.invocationCallOrder[0]);
  });

  it('una nota que no existe es nota-no-encontrada y no escribe nada', async () => {
    const { servicio, repo } = montar({ nota: undefined });

    const error: unknown = await servicio
      .registrarCobranza(cobro(), contexto, trx)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(CobranzaRechazada);
    expect(error).toMatchObject({ razon: 'nota-no-encontrada' });
    expect(repo.bloquearNotasDelCliente).not.toHaveBeenCalled();
    expect(repo.insertarAbono).not.toHaveBeenCalled();
    expect(repo.insertarSaldoFavor).not.toHaveBeenCalled();
  });

  it('una nota de un cliente de otra sucursal es nota-no-encontrada', async () => {
    const { servicio, repo } = montar({
      nota: { id: A, clienteId: CLIENTE, sucursalId: 'sucursal-mx' },
    });
    await expect(
      servicio.registrarCobranza(cobro(), contexto, trx),
    ).rejects.toMatchObject({
      razon: 'nota-no-encontrada',
    });
    expect(repo.insertarAbono).not.toHaveBeenCalled();
  });

  it('una nota de otro cliente es nota-no-encontrada', async () => {
    const { servicio, repo } = montar({
      nota: { id: A, clienteId: 'cliente-2', sucursalId: SUCURSAL },
    });
    await expect(
      servicio.registrarCobranza(cobro(), contexto, trx),
    ).rejects.toMatchObject({
      razon: 'nota-no-encontrada',
    });
    expect(repo.insertarAbono).not.toHaveBeenCalled();
  });
});
