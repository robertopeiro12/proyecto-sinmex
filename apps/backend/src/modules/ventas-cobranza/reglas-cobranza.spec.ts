import {
  esCobrable,
  repartirPago,
  saldoDerivadoCentavos,
  type NotaParaReparto,
  type Reparto,
} from './reglas-cobranza';

/**
 * CASOS COMPARTIDOS CON LA TABLET (T-20, D1).
 *
 * Esta tabla se copia tal cual a
 * `apps/tablet/src/datos/cobranzas-reglas.spec.ts`. Si cambias un caso aqui,
 * cambialo alla en el mismo commit: el reparto local de la tablet tiene que dar
 * lo mismo que el del servidor.
 */
const nota = (
  id: string,
  fecha: string,
  folio: string,
  saldoCentavos: number,
  cobrable = true,
): NotaParaReparto => ({ id, fecha, folio, cobrable, saldoCentavos });

interface CasoReparto {
  nombre: string;
  monto: number;
  elegida: string;
  notas: NotaParaReparto[];
  esperado: Reparto;
}

const CASOS_REPARTO: CasoReparto[] = [
  {
    nombre: 'abono parcial a la nota elegida',
    monto: 5000,
    elegida: 'A',
    notas: [nota('A', '2026-08-01', 'TJ260801AP01', 15000)],
    esperado: {
      aplicaciones: [
        {
          notaId: 'A',
          montoCentavos: 5000,
          saldoAntesCentavos: 15000,
          saldoDespuesCentavos: 10000,
          tipo: 'abono',
          status: 'abonado',
        },
      ],
      saldoFavorCentavos: 0,
    },
  },
  {
    nombre: 'liquida exacto',
    monto: 15000,
    elegida: 'A',
    notas: [nota('A', '2026-08-01', 'TJ260801AP01', 15000)],
    esperado: {
      aplicaciones: [
        {
          notaId: 'A',
          montoCentavos: 15000,
          saldoAntesCentavos: 15000,
          saldoDespuesCentavos: 0,
          tipo: 'cobranza',
          status: 'pagada',
        },
      ],
      saldoFavorCentavos: 0,
    },
  },
  {
    nombre: 'el excedente va a las otras notas, de la mas vieja a la mas nueva',
    monto: 15000,
    elegida: 'B',
    notas: [
      nota('C', '2026-08-03', 'TJ260803AP01', 4000),
      nota('B', '2026-08-05', 'TJ260805AP01', 10000),
      nota('A', '2026-08-01', 'TJ260801AP01', 3000),
    ],
    esperado: {
      aplicaciones: [
        {
          notaId: 'B',
          montoCentavos: 10000,
          saldoAntesCentavos: 10000,
          saldoDespuesCentavos: 0,
          tipo: 'cobranza',
          status: 'pagada',
        },
        {
          notaId: 'A',
          montoCentavos: 3000,
          saldoAntesCentavos: 3000,
          saldoDespuesCentavos: 0,
          tipo: 'cobranza',
          status: 'pagada',
        },
        {
          notaId: 'C',
          montoCentavos: 2000,
          saldoAntesCentavos: 4000,
          saldoDespuesCentavos: 2000,
          tipo: 'abono',
          status: 'abonado',
        },
      ],
      saldoFavorCentavos: 0,
    },
  },
  {
    nombre: 'misma fecha: desempata el folio',
    monto: 3000,
    elegida: 'X',
    notas: [
      nota('X', '2026-08-04', 'TJ260804AP09', 1000),
      nota('N2', '2026-08-01', 'TJ260801AP02', 5000),
      nota('N1', '2026-08-01', 'TJ260801AP01', 5000),
    ],
    esperado: {
      aplicaciones: [
        {
          notaId: 'X',
          montoCentavos: 1000,
          saldoAntesCentavos: 1000,
          saldoDespuesCentavos: 0,
          tipo: 'cobranza',
          status: 'pagada',
        },
        {
          notaId: 'N1',
          montoCentavos: 2000,
          saldoAntesCentavos: 5000,
          saldoDespuesCentavos: 3000,
          tipo: 'abono',
          status: 'abonado',
        },
      ],
      saldoFavorCentavos: 0,
    },
  },
  {
    nombre: 'lo que sobra de todas las notas queda a favor',
    monto: 5000,
    elegida: 'A',
    notas: [
      nota('A', '2026-08-01', 'TJ260801AP01', 1000),
      nota('B', '2026-08-02', 'TJ260802AP01', 2000),
    ],
    esperado: {
      aplicaciones: [
        {
          notaId: 'A',
          montoCentavos: 1000,
          saldoAntesCentavos: 1000,
          saldoDespuesCentavos: 0,
          tipo: 'cobranza',
          status: 'pagada',
        },
        {
          notaId: 'B',
          montoCentavos: 2000,
          saldoAntesCentavos: 2000,
          saldoDespuesCentavos: 0,
          tipo: 'cobranza',
          status: 'pagada',
        },
      ],
      saldoFavorCentavos: 2000,
    },
  },
  {
    nombre:
      'nota elegida que ya no se puede cobrar: todo pasa a excedente (D9)',
    monto: 2000,
    elegida: 'A',
    notas: [
      nota('A', '2026-08-01', 'TJ260801AP01', 0, false),
      nota('B', '2026-08-02', 'TJ260802AP01', 3000),
    ],
    esperado: {
      aplicaciones: [
        {
          notaId: 'B',
          montoCentavos: 2000,
          saldoAntesCentavos: 3000,
          saldoDespuesCentavos: 1000,
          tipo: 'abono',
          status: 'abonado',
        },
      ],
      saldoFavorCentavos: 0,
    },
  },
  {
    nombre:
      'las otras notas que no se pueden cobrar se saltan aunque tengan saldo',
    monto: 2500,
    elegida: 'A',
    notas: [
      nota('A', '2026-08-05', 'TJ260805AP01', 1000),
      nota('B', '2026-08-01', 'TJ260801AP01', 5000, false),
      nota('C', '2026-08-02', 'TJ260802AP01', 2000),
    ],
    esperado: {
      aplicaciones: [
        {
          notaId: 'A',
          montoCentavos: 1000,
          saldoAntesCentavos: 1000,
          saldoDespuesCentavos: 0,
          tipo: 'cobranza',
          status: 'pagada',
        },
        {
          notaId: 'C',
          montoCentavos: 1500,
          saldoAntesCentavos: 2000,
          saldoDespuesCentavos: 500,
          tipo: 'abono',
          status: 'abonado',
        },
      ],
      saldoFavorCentavos: 0,
    },
  },
  {
    nombre: 'sin otras notas, el excedente queda a favor',
    monto: 1500,
    elegida: 'A',
    notas: [nota('A', '2026-08-01', 'TJ260801AP01', 1000)],
    esperado: {
      aplicaciones: [
        {
          notaId: 'A',
          montoCentavos: 1000,
          saldoAntesCentavos: 1000,
          saldoDespuesCentavos: 0,
          tipo: 'cobranza',
          status: 'pagada',
        },
      ],
      saldoFavorCentavos: 500,
    },
  },
  {
    nombre: 'una nota con saldo 0 no recibe nada',
    monto: 1000,
    elegida: 'A',
    notas: [
      nota('A', '2026-08-01', 'TJ260801AP01', 0),
      nota('B', '2026-08-02', 'TJ260802AP01', 1000),
    ],
    esperado: {
      aplicaciones: [
        {
          notaId: 'B',
          montoCentavos: 1000,
          saldoAntesCentavos: 1000,
          saldoDespuesCentavos: 0,
          tipo: 'cobranza',
          status: 'pagada',
        },
      ],
      saldoFavorCentavos: 0,
    },
  },
  {
    nombre: 'la elegida va primero aunque sea la mas nueva',
    monto: 3000,
    elegida: 'N',
    notas: [
      nota('V', '2026-08-01', 'TJ260801AP01', 2000),
      nota('N', '2026-08-09', 'TJ260809AP01', 2000),
    ],
    esperado: {
      aplicaciones: [
        {
          notaId: 'N',
          montoCentavos: 2000,
          saldoAntesCentavos: 2000,
          saldoDespuesCentavos: 0,
          tipo: 'cobranza',
          status: 'pagada',
        },
        {
          notaId: 'V',
          montoCentavos: 1000,
          saldoAntesCentavos: 2000,
          saldoDespuesCentavos: 1000,
          tipo: 'abono',
          status: 'abonado',
        },
      ],
      saldoFavorCentavos: 0,
    },
  },
  {
    nombre: 'una nota elegida que no esta en la lista: todo es excedente',
    monto: 1000,
    elegida: 'Z',
    notas: [nota('B', '2026-08-02', 'TJ260802AP01', 1000)],
    esperado: {
      aplicaciones: [
        {
          notaId: 'B',
          montoCentavos: 1000,
          saldoAntesCentavos: 1000,
          saldoDespuesCentavos: 0,
          tipo: 'cobranza',
          status: 'pagada',
        },
      ],
      saldoFavorCentavos: 0,
    },
  },
];

describe('repartirPago (D1, D8, D9)', () => {
  it.each(CASOS_REPARTO)('$nombre', ({ monto, elegida, notas, esperado }) => {
    expect(repartirPago(monto, elegida, notas)).toEqual(esperado);
  });

  it('no reordena ni modifica la lista que recibe', () => {
    const notas = [
      nota('C', '2026-08-03', 'TJ260803AP01', 4000),
      nota('B', '2026-08-05', 'TJ260805AP01', 10000),
    ];
    const copia = notas.map((n) => ({ ...n }));
    repartirPago(12000, 'B', notas);
    expect(notas).toEqual(copia);
  });

  it.each([0, -100, 15.5, Number.NaN])(
    'un monto de %p no es un pago: es un bug de quien llama',
    (monto) => {
      expect(() =>
        repartirPago(monto, 'A', [
          nota('A', '2026-08-01', 'TJ260801AP01', 1000),
        ]),
      ).toThrow(Error);
    },
  );
});

describe('esCobrable', () => {
  it.each([
    ['pendiente', true],
    ['abonado', true],
    ['pagada', false],
    ['cuenta_perdida', false],
    ['promocion', false],
  ])('una nota %s viva, cobrable = %p', (status, esperado) => {
    expect(esCobrable(status, false)).toBe(esperado);
  });

  it('una nota borrada nunca es cobrable, aunque diga pendiente', () => {
    expect(esCobrable('pendiente', true)).toBe(false);
  });
});

describe('saldoDerivadoCentavos (D7)', () => {
  it('es el monto total menos lo abonado', () => {
    expect(saldoDerivadoCentavos(25000, 10000)).toBe(15000);
  });

  it('nunca es negativo, aunque los abonos pasen del total', () => {
    expect(saldoDerivadoCentavos(25000, 30000)).toBe(0);
  });
});
