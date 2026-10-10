import type { Transaction } from 'kysely';
import type { DB } from '../../database/schema';
import type { CobranzaNormalizada } from './datos-cobranza';
import { CobranzaRechazada } from './cobranza-rechazada';
import type { NotaBloqueada, NotaParaCobro } from './cobranzas.repository';
import {
  CobranzasService,
  type ContextoCobranza,
  type PagoEnNotas,
} from './cobranzas.service';
import { PagoRechazado } from './pago-rechazado';

const CLIENTE = 'cliente-1';
const SUCURSAL = 'sucursal-tj';
const A = 'nota-a';
const B = 'nota-b';
const C = 'nota-c';

/** El servicio no usa la transaccion: solo la pasa a quien escribe. */
const trx = {} as Transaction<DB>;

/** La tablet: su vendedor y sin usuario. */
const contexto: ContextoCobranza = {
  sucursalId: SUCURSAL,
  fechaOperacion: '2026-09-14',
  vendedorId: 'vendedor-1',
  usuarioId: null,
};

/** El portal (T-21): Oficina y quien capturo. */
const contextoPortal: ContextoCobranza = {
  sucursalId: SUCURSAL,
  fechaOperacion: '2026-10-07',
  vendedorId: null,
  usuarioId: 'usuario-1',
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

const pago = (extra: Partial<PagoEnNotas> = {}): PagoEnNotas => ({
  clienteId: CLIENTE,
  notaIds: [C, B],
  montoCentavos: 12000,
  metodoPago: 'transferencia',
  fechaPago: '2026-10-05',
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
  numNota: null,
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
    saldoFavor?: string[];
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
    bloquearSaldoFavor: jest.fn().mockResolvedValue(opciones.saldoFavor ?? []),
  };
  const servicio = new CobranzasService(repo);
  return { servicio, repo };
}

/** A (08-01, $100), B (08-03, $80) y C (08-05, $50), sin abonos. */
const tresNotas = (saldoFavor?: string[]) =>
  montar({
    bloqueadas: [
      bloqueada(A, '2026-08-01', '100.00'),
      bloqueada(B, '2026-08-03', '80.00'),
      bloqueada(C, '2026-08-05', '50.00'),
    ],
    abonado: new Map(),
    saldoFavor,
  });

describe('CobranzasService.registrarCobranza (tablet, T-20)', () => {
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
        origen: 'cobro',
        capturoUsuarioId: null,
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

  it('el excedente va a las otras notas por fecha y el resto a saldo a favor', async () => {
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
      expect.objectContaining({ ventaNotaId: A, monto: '100.00' }),
      trx,
    );
    expect(repo.insertarAbono).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ ventaNotaId: C, monto: '30.00' }),
      trx,
    );
    expect(repo.insertarAbono).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ ventaNotaId: B, monto: '80.00' }),
      trx,
    );
    expect(repo.insertarSaldoFavor).toHaveBeenCalledWith(
      {
        clienteId: CLIENTE,
        vendedorId: 'vendedor-1',
        monto: '40.00',
        origen: 'excedente_cobro',
        fechaOperacion: '2026-09-14',
        capturoUsuarioId: null,
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

    expect(repo.bloquearNotasDelCliente).toHaveBeenCalledWith(
      CLIENTE,
      [A],
      trx,
    );
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

describe('CobranzasService.registrarPago (portal, T-21)', () => {
  it('paga primero la palomeada mas vieja y la ultima queda abonada; las demas no se tocan', async () => {
    const { servicio, repo } = tresNotas();

    const plan = await servicio.registrarPago(pago(), contextoPortal, trx);

    expect(plan).toEqual({
      aplicaciones: [
        {
          notaId: B,
          folio: 'TJ260803AP01',
          numNota: null,
          fecha: '2026-08-03',
          montoCentavos: 8000,
          saldoAntesCentavos: 8000,
          saldoDespuesCentavos: 0,
          status: 'pagada',
          palomeada: true,
        },
        {
          notaId: C,
          folio: 'TJ260805AP01',
          numNota: null,
          fecha: '2026-08-05',
          montoCentavos: 4000,
          saldoAntesCentavos: 5000,
          saldoDespuesCentavos: 1000,
          status: 'abonado',
          palomeada: true,
        },
      ],
      saldoFavorCentavos: 0,
    });
    expect(repo.insertarAbono).toHaveBeenCalledTimes(2);
    expect(repo.insertarAbono).toHaveBeenNthCalledWith(
      1,
      {
        ventaNotaId: B,
        vendedorId: null,
        fechaPago: '2026-10-05',
        fechaOperacion: '2026-10-07',
        monto: '80.00',
        tipo: 'cobranza',
        saldoPendiente: '0.00',
        metodoPago: 'transferencia',
        origen: 'cobro',
        capturoUsuarioId: 'usuario-1',
      },
      trx,
    );
    expect(repo.actualizarStatusNota).not.toHaveBeenCalledWith(
      A,
      expect.anything(),
      trx,
    );
    expect(repo.insertarSaldoFavor).not.toHaveBeenCalled();
  });

  it('lo que sobra va a las demas (de la mas vieja) y luego a saldo a favor, sin cobrador', async () => {
    const { servicio, repo } = tresNotas();

    const plan = await servicio.registrarPago(
      pago({ notaIds: [C], montoCentavos: 30000 }),
      contextoPortal,
      trx,
    );

    expect(
      plan.aplicaciones.map((a) => [a.notaId, a.montoCentavos, a.palomeada]),
    ).toEqual([
      [C, 5000, true],
      [A, 10000, false],
      [B, 8000, false],
    ]);
    expect(plan.saldoFavorCentavos).toBe(7000);
    expect(repo.insertarSaldoFavor).toHaveBeenCalledWith(
      {
        clienteId: CLIENTE,
        vendedorId: null,
        monto: '70.00',
        origen: 'excedente_cobro',
        fechaOperacion: '2026-10-07',
        capturoUsuarioId: 'usuario-1',
      },
      trx,
    );
  });

  it('bloquea las notas del cliente con TODAS las palomeadas antes de leer lo abonado', async () => {
    const { servicio, repo } = tresNotas();
    await servicio.registrarPago(pago(), contextoPortal, trx);
    expect(repo.bloquearNotasDelCliente).toHaveBeenCalledWith(
      CLIENTE,
      [C, B],
      trx,
    );
    expect(
      repo.bloquearNotasDelCliente.mock.invocationCallOrder[0],
    ).toBeLessThan(repo.abonadoPorNota.mock.invocationCallOrder[0]);
  });

  it('Review Focus 1: una palomeada que ya quedo pagada (la cobro la tablet) se rechaza y no se graba nada', async () => {
    const { servicio, repo } = montar({
      bloqueadas: [
        bloqueada(B, '2026-08-03', '80.00', { status: 'pagada' }),
        bloqueada(C, '2026-08-05', '50.00'),
      ],
      abonado: new Map([[B, '80.00']]),
    });

    const error: unknown = await servicio
      .registrarPago(pago(), contextoPortal, trx)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(PagoRechazado);
    expect(error).toMatchObject({
      razon: 'nota-sin-saldo',
      message: 'La nota TJ260803AP01 ya no tiene saldo; vuelve a cargar.',
    });
    expect(repo.insertarAbono).not.toHaveBeenCalled();
    expect(repo.actualizarStatusNota).not.toHaveBeenCalled();
    expect(repo.insertarSaldoFavor).not.toHaveBeenCalled();
  });

  it.each<[string, Partial<NotaBloqueada>, Map<string, string>]>([
    ['abonado pero ya en 0', { status: 'abonado' }, new Map([[B, '80.00']])],
    ['borrada', { borrada: true }, new Map()],
    ['de cuenta perdida', { status: 'cuenta_perdida' }, new Map()],
  ])(
    'una palomeada %s tambien es nota-sin-saldo',
    async (_caso, extra, abonado) => {
      const { servicio } = montar({
        bloqueadas: [
          bloqueada(B, '2026-08-03', '80.00', extra),
          bloqueada(C, '2026-08-05', '50.00'),
        ],
        abonado,
      });
      await expect(
        servicio.registrarPago(pago(), contextoPortal, trx),
      ).rejects.toMatchObject({ razon: 'nota-sin-saldo' });
    },
  );

  it('una palomeada que no llego bloqueada (de otro cliente o inexistente) es nota-ajena', async () => {
    const { servicio, repo } = montar({
      bloqueadas: [bloqueada(C, '2026-08-05', '50.00')],
      abonado: new Map(),
    });
    await expect(
      servicio.registrarPago(pago(), contextoPortal, trx),
    ).rejects.toMatchObject({
      razon: 'nota-ajena',
      message:
        'Una de las notas marcadas no es de este cliente o ya no existe; vuelve a cargar.',
    });
    expect(repo.insertarAbono).not.toHaveBeenCalled();
  });

  it('Review Focus 2: una fecha de pago anterior a la palomeada mas vieja se rechaza', async () => {
    const { servicio, repo } = tresNotas();
    await expect(
      servicio.registrarPago(
        pago({ fechaPago: '2026-08-02' }),
        contextoPortal,
        trx,
      ),
    ).rejects.toMatchObject({
      razon: 'fecha-anterior',
      message:
        'La fecha del pago no puede ser anterior a la nota más vieja que marcaste (2026-08-03).',
    });
    expect(repo.insertarAbono).not.toHaveBeenCalled();
  });

  it('el mismo dia que la palomeada mas vieja si se acepta', async () => {
    const { servicio } = tresNotas();
    await expect(
      servicio.registrarPago(
        pago({ fechaPago: '2026-08-03' }),
        contextoPortal,
        trx,
      ),
    ).resolves.toMatchObject({ saldoFavorCentavos: 0 });
  });
});

describe('CobranzasService.planearPago (vista previa, T-21)', () => {
  it('da el mismo reparto que registrarPago sin escribir nada', async () => {
    const { servicio, repo } = tresNotas();
    const plan = await servicio.planearPago(
      { clienteId: CLIENTE, notaIds: [C, B], montoCentavos: 12000 },
      trx,
    );
    expect(plan.aplicaciones.map((a) => [a.notaId, a.montoCentavos])).toEqual([
      [B, 8000],
      [C, 4000],
    ]);
    expect(repo.insertarAbono).not.toHaveBeenCalled();
    expect(repo.actualizarStatusNota).not.toHaveBeenCalled();
    expect(repo.insertarSaldoFavor).not.toHaveBeenCalled();
  });

  it('tambien rechaza una palomeada sin saldo', async () => {
    const { servicio } = montar({
      bloqueadas: [bloqueada(B, '2026-08-03', '80.00', { status: 'pagada' })],
      abonado: new Map([[B, '80.00']]),
    });
    await expect(
      servicio.planearPago(
        { clienteId: CLIENTE, notaIds: [B], montoCentavos: 100 },
        trx,
      ),
    ).rejects.toMatchObject({ razon: 'nota-sin-saldo' });
  });
});

describe('CobranzasService.aplicarSaldoFavor (T-21)', () => {
  it('reparte solo entre las palomeadas, con metodo y origen saldo_favor, y deja el movimiento negativo', async () => {
    const { servicio, repo } = tresNotas(['150.00']);

    const plan = await servicio.aplicarSaldoFavor(
      { clienteId: CLIENTE, notaIds: [A, B], montoCentavos: 12000 },
      contextoPortal,
      trx,
    );

    expect(
      plan.aplicaciones.map((a) => [a.notaId, a.montoCentavos, a.status]),
    ).toEqual([
      [A, 10000, 'pagada'],
      [B, 2000, 'abonado'],
    ]);
    expect(plan.saldoFavorCentavos).toBe(0);
    expect(repo.insertarAbono).toHaveBeenNthCalledWith(
      1,
      {
        ventaNotaId: A,
        vendedorId: null,
        fechaPago: '2026-10-07',
        fechaOperacion: '2026-10-07',
        monto: '100.00',
        tipo: 'cobranza',
        saldoPendiente: '0.00',
        metodoPago: 'saldo_favor',
        origen: 'saldo_favor',
        capturoUsuarioId: 'usuario-1',
      },
      trx,
    );
    expect(repo.actualizarStatusNota).not.toHaveBeenCalledWith(
      C,
      expect.anything(),
      trx,
    );
    expect(repo.insertarSaldoFavor).toHaveBeenCalledTimes(1);
    expect(repo.insertarSaldoFavor).toHaveBeenCalledWith(
      {
        clienteId: CLIENTE,
        vendedorId: null,
        monto: '-120.00',
        origen: 'aplicacion',
        fechaOperacion: '2026-10-07',
        capturoUsuarioId: 'usuario-1',
      },
      trx,
    );
  });

  it('bloquea el saldo a favor DESPUES de las notas: mismo orden de candados que el cobro', async () => {
    const { servicio, repo } = tresNotas(['150.00']);
    await servicio.aplicarSaldoFavor(
      { clienteId: CLIENTE, notaIds: [A], montoCentavos: 1000 },
      contextoPortal,
      trx,
    );
    expect(repo.bloquearSaldoFavor).toHaveBeenCalledWith(CLIENTE, trx);
    expect(
      repo.bloquearNotasDelCliente.mock.invocationCallOrder[0],
    ).toBeLessThan(repo.bloquearSaldoFavor.mock.invocationCallOrder[0]);
  });

  it('Review Focus 3: mas saldo a favor del que hay se rechaza y no se graba nada', async () => {
    const { servicio, repo } = tresNotas(['100.00', '-30.00']);
    await expect(
      servicio.aplicarSaldoFavor(
        { clienteId: CLIENTE, notaIds: [A, B], montoCentavos: 8000 },
        contextoPortal,
        trx,
      ),
    ).rejects.toMatchObject({
      razon: 'saldo-favor-insuficiente',
      message: 'El cliente solo tiene $70.00 de saldo a favor.',
    });
    expect(repo.insertarAbono).not.toHaveBeenCalled();
    expect(repo.insertarSaldoFavor).not.toHaveBeenCalled();
  });

  it('Review Focus 3: mas de lo que deben las palomeadas se rechaza (no se mueve saldo a favor a saldo a favor)', async () => {
    const { servicio, repo } = tresNotas(['500.00']);
    await expect(
      servicio.aplicarSaldoFavor(
        { clienteId: CLIENTE, notaIds: [B], montoCentavos: 9000 },
        contextoPortal,
        trx,
      ),
    ).rejects.toMatchObject({
      razon: 'excede-lo-que-deben',
      message:
        'Las notas marcadas solo deben $80.00: no se puede aplicar más saldo a favor que eso.',
    });
    expect(repo.insertarAbono).not.toHaveBeenCalled();
  });

  it('un id repetido no duplica lo que deben las notas: un monto por encima de la deuda real se rechaza', async () => {
    const { servicio, repo } = tresNotas(['500.00']);
    await expect(
      servicio.aplicarSaldoFavor(
        { clienteId: CLIENTE, notaIds: [A, A], montoCentavos: 15000 },
        contextoPortal,
        trx,
      ),
    ).rejects.toMatchObject({
      razon: 'excede-lo-que-deben',
      message:
        'Las notas marcadas solo deben $100.00: no se puede aplicar más saldo a favor que eso.',
    });
    expect(repo.insertarAbono).not.toHaveBeenCalled();
  });

  it('un id en mayusculas se reconoce como el de la nota, no como ajeno', async () => {
    const { servicio, repo } = tresNotas(['500.00']);
    const plan = await servicio.planearPago(
      {
        clienteId: CLIENTE,
        notaIds: [A.toUpperCase(), A],
        montoCentavos: 5000,
      },
      trx,
    );
    expect(plan.aplicaciones.map((a) => a.notaId)).toEqual([A]);
    expect(repo.bloquearNotasDelCliente).toHaveBeenCalledWith(
      CLIENTE,
      [A],
      trx,
    );
  });

  it('las filas escritas llevan vendedor null aunque el contexto traiga uno', async () => {
    const { servicio, repo } = tresNotas(['150.00']);
    await servicio.aplicarSaldoFavor(
      { clienteId: CLIENTE, notaIds: [A], montoCentavos: 1000 },
      { ...contextoPortal, vendedorId: 'vendedor-1' },
      trx,
    );
    expect(repo.insertarAbono).toHaveBeenCalledWith(
      expect.objectContaining({ vendedorId: null }),
      trx,
    );
    expect(repo.insertarSaldoFavor).toHaveBeenCalledWith(
      expect.objectContaining({ vendedorId: null, origen: 'aplicacion' }),
      trx,
    );
  });

  it('planearSaldoFavor da el mismo plan sin escribir', async () => {
    const { servicio, repo } = tresNotas(['150.00']);
    const plan = await servicio.planearSaldoFavor(
      { clienteId: CLIENTE, notaIds: [A, B], montoCentavos: 12000 },
      trx,
    );
    expect(plan.aplicaciones.map((a) => a.notaId)).toEqual([A, B]);
    expect(repo.insertarAbono).not.toHaveBeenCalled();
    expect(repo.insertarSaldoFavor).not.toHaveBeenCalled();
  });
});
