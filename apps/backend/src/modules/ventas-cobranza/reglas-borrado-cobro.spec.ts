import {
  MOTIVO_SALDO_FAVOR_APLICADO,
  planearBorrado,
  statusTrasBorrar,
  type NotaDelPago,
} from './reglas-borrado-cobro';

const nota = (
  id: string,
  fecha: string,
  extra: Partial<NotaDelPago> = {},
): NotaDelPago => ({
  id,
  folio: `TJ${fecha.slice(2, 4)}${fecha.slice(5, 7)}${fecha.slice(8, 10)}AP01`,
  numNota: null,
  fecha,
  status: 'pagada',
  montoTotalCentavos: 10000,
  abonadoVivoCentavos: 10000,
  delPagoCentavos: 10000,
  ...extra,
});

describe('statusTrasBorrar', () => {
  it.each([
    ['sin nada abonado vuelve a pendiente', 'pagada', 10000, 0, 'pendiente'],
    ['con algo abonado queda abonado', 'pagada', 10000, 4000, 'abonado'],
    [
      'si otro pago la sigue cubriendo completa, pagada',
      'pagada',
      10000,
      10000,
      'pagada',
    ],
    [
      'abonos por encima del total (datos viejos) siguen siendo pagada',
      'pagada',
      10000,
      12000,
      'pagada',
    ],
    [
      'una abonada que pierde su unico abono vuelve a pendiente',
      'abonado',
      10000,
      0,
      'pendiente',
    ],
    [
      'cuenta perdida se queda en cuenta perdida',
      'cuenta_perdida',
      10000,
      0,
      'cuenta_perdida',
    ],
  ])('%s', (_n, actual, total, restante, esperado) => {
    expect(statusTrasBorrar(actual, total, restante)).toBe(esperado);
  });
});

describe('planearBorrado', () => {
  it('un pago a dos notas con excedente: cada nota vuelve a deber lo suyo y el saldo a favor baja', () => {
    const plan = planearBorrado({
      notas: [
        nota('B', '2026-08-03', {
          montoTotalCentavos: 50000,
          abonadoVivoCentavos: 50000,
          delPagoCentavos: 50000,
        }),
        nota('A', '2026-08-01', {
          montoTotalCentavos: 60000,
          abonadoVivoCentavos: 60000,
          delPagoCentavos: 40000,
        }),
      ],
      saldoFavorVivoCentavos: 30000,
      movimientoDelPagoCentavos: 10000,
    });

    expect(plan).toEqual({
      notas: [
        {
          notaId: 'A',
          folio: 'TJ260801AP01',
          numNota: null,
          fecha: '2026-08-01',
          delPagoCentavos: 40000,
          saldoAntesCentavos: 0,
          saldoDespuesCentavos: 40000,
          statusDespues: 'abonado',
        },
        {
          notaId: 'B',
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
      bloqueo: null,
    });
  });

  it('borrar una aplicacion de saldo a favor devuelve el saldo', () => {
    const plan = planearBorrado({
      notas: [
        nota('A', '2026-08-01', {
          status: 'abonado',
          abonadoVivoCentavos: 3000,
          delPagoCentavos: 3000,
        }),
      ],
      saldoFavorVivoCentavos: 2000,
      movimientoDelPagoCentavos: -3000,
    });
    expect(plan.saldoFavorAntesCentavos).toBe(2000);
    expect(plan.saldoFavorDespuesCentavos).toBe(5000);
    expect(plan.notas[0]).toMatchObject({
      saldoAntesCentavos: 7000,
      saldoDespuesCentavos: 10000,
      statusDespues: 'pendiente',
    });
    expect(plan.bloqueo).toBeNull();
  });

  it('el excedente justo igual al saldo vivo se puede borrar (queda en 0)', () => {
    const plan = planearBorrado({
      notas: [],
      saldoFavorVivoCentavos: 5000,
      movimientoDelPagoCentavos: 5000,
    });
    expect(plan.saldoFavorDespuesCentavos).toBe(0);
    expect(plan.bloqueo).toBeNull();
  });

  it('Review Focus 1: si el excedente ya se aplico (quedaria en -$0.01), se bloquea con el mensaje', () => {
    const plan = planearBorrado({
      notas: [nota('A', '2026-08-01')],
      saldoFavorVivoCentavos: 4999,
      movimientoDelPagoCentavos: 5000,
    });
    expect(plan.saldoFavorDespuesCentavos).toBe(-1);
    expect(plan.bloqueo).toEqual({
      codigo: 'saldo-favor-aplicado',
      motivo: MOTIVO_SALDO_FAVOR_APLICADO,
    });
    expect(MOTIVO_SALDO_FAVOR_APLICADO).toBe(
      'El saldo a favor que dejó este pago ya se aplicó a otras notas. Primero borra el pago que lo aplicó.',
    );
  });

  it('Review Focus 3: con otro pago vivo la nota queda abonada, y en cuenta perdida no cambia', () => {
    const plan = planearBorrado({
      notas: [
        nota('A', '2026-08-01', {
          abonadoVivoCentavos: 10000,
          delPagoCentavos: 6000,
        }),
        nota('B', '2026-08-02', {
          status: 'cuenta_perdida',
          abonadoVivoCentavos: 2000,
          delPagoCentavos: 2000,
        }),
      ],
      saldoFavorVivoCentavos: 0,
      movimientoDelPagoCentavos: 0,
    });
    expect(
      plan.notas.map((n) => [
        n.notaId,
        n.statusDespues,
        n.saldoDespuesCentavos,
      ]),
    ).toEqual([
      ['A', 'abonado', 6000],
      ['B', 'cuenta_perdida', 10000],
    ]);
  });

  it('a igual fecha ordena por folio', () => {
    const plan = planearBorrado({
      notas: [
        nota('Z', '2026-08-01', { folio: 'TJ260801AP09' }),
        nota('Y', '2026-08-01', { folio: 'TJ260801AP02' }),
      ],
      saldoFavorVivoCentavos: 0,
      movimientoDelPagoCentavos: 0,
    });
    expect(plan.notas.map((n) => n.notaId)).toEqual(['Y', 'Z']);
  });
});
