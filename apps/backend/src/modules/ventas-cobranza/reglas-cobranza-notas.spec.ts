import {
  repartirPago,
  repartirPagoEnNotas,
  type NotaParaReparto,
} from './reglas-cobranza';

/**
 * `repartirPagoEnNotas` (T-21): la oficina palomea VARIAS notas. Las pruebas de
 * `repartirPago` (una nota, compartidas con la tablet) siguen en
 * `reglas-cobranza.spec.ts` sin cambiar: son la garantia de que la tablet no
 * nota nada.
 */
const nota = (
  id: string,
  fecha: string,
  folio: string,
  saldoCentavos: number,
  cobrable = true,
): NotaParaReparto => ({ id, fecha, folio, cobrable, saldoCentavos });

// A es la mas vieja; las palomeadas son C y B, mandadas en desorden.
const NOTAS = [
  nota('C', '2026-08-05', 'TJ260805AP01', 5000),
  nota('A', '2026-08-01', 'TJ260801AP01', 10000),
  nota('B', '2026-08-03', 'TJ260803AP01', 8000),
];

describe('repartirPagoEnNotas (T-21)', () => {
  it('paga primero la palomeada mas vieja aunque llegue en desorden; la ultima queda abonada', () => {
    expect(repartirPagoEnNotas(12000, ['C', 'B'], NOTAS)).toEqual({
      aplicaciones: [
        {
          notaId: 'B',
          montoCentavos: 8000,
          saldoAntesCentavos: 8000,
          saldoDespuesCentavos: 0,
          tipo: 'cobranza',
          status: 'pagada',
        },
        {
          notaId: 'C',
          montoCentavos: 4000,
          saldoAntesCentavos: 5000,
          saldoDespuesCentavos: 1000,
          tipo: 'abono',
          status: 'abonado',
        },
      ],
      saldoFavorCentavos: 0,
    });
  });

  it('lo que sobra de las palomeadas va a las demas de la mas vieja a la mas nueva, y luego a saldo a favor', () => {
    const r = repartirPagoEnNotas(30000, ['C'], NOTAS);
    expect(r.aplicaciones.map((a) => [a.notaId, a.montoCentavos])).toEqual([
      ['C', 5000],
      ['A', 10000],
      ['B', 8000],
    ]);
    expect(r.saldoFavorCentavos).toBe(7000);
  });

  it('una palomeada que ya no es cobrable no recibe nada y el dinero sigue su orden', () => {
    const notas = [
      nota('A', '2026-08-01', 'TJ260801AP01', 10000, false),
      nota('B', '2026-08-03', 'TJ260803AP01', 8000),
    ];
    const r = repartirPagoEnNotas(5000, ['A', 'B'], notas);
    expect(r.aplicaciones.map((a) => [a.notaId, a.montoCentavos])).toEqual([
      ['B', 5000],
    ]);
  });

  it('con la misma fecha desempata el folio', () => {
    const notas = [
      nota('X', '2026-08-01', 'TJ260801AP02', 1000),
      nota('Y', '2026-08-01', 'TJ260801AP01', 1000),
    ];
    expect(
      repartirPagoEnNotas(1500, ['X', 'Y'], notas).aplicaciones.map(
        (a) => a.notaId,
      ),
    ).toEqual(['Y', 'X']);
  });

  it('con una sola elegida da exactamente lo mismo que repartirPago', () => {
    for (const elegida of ['A', 'B', 'C', 'no-existe']) {
      for (const monto of [1, 4000, 12000, 23000, 30000]) {
        expect(repartirPagoEnNotas(monto, [elegida], NOTAS)).toEqual(
          repartirPago(monto, elegida, NOTAS),
        );
      }
    }
  });

  it('un monto que no es entero positivo es un bug de quien llama', () => {
    expect(() => repartirPagoEnNotas(0, ['A'], NOTAS)).toThrow(Error);
    expect(() => repartirPagoEnNotas(10.5, ['A'], NOTAS)).toThrow(Error);
  });
});
