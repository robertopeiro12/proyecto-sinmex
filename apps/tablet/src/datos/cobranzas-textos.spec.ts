import type { Reparto } from './cobranzas-reglas';
import { lineasDelCobro, NOMBRE_METODO } from './cobranzas-textos';

describe('textos de la cobranza (T-21)', () => {
  it('el abono que aplico la oficina con saldo a favor se nombra "Saldo a favor"', () => {
    expect(NOMBRE_METODO.saldo_favor).toBe('Saldo a favor');
    expect(NOMBRE_METODO.efectivo).toBe('efectivo');
  });

  it('lineasDelCobro pone el folio de cada nota que recibio dinero, en el orden del reparto', () => {
    const reparto: Reparto = {
      aplicaciones: [
        { notaId: 'nota-2', montoCentavos: 10000, saldoAntesCentavos: 10000, saldoDespuesCentavos: 0, tipo: 'cobranza', status: 'pagada' },
        { notaId: 'nota-1', montoCentavos: 2000, saldoAntesCentavos: 15000, saldoDespuesCentavos: 13000, tipo: 'abono', status: 'abonado' },
      ],
      saldoFavorCentavos: 0,
    };
    expect(
      lineasDelCobro(reparto, [
        { id: 'nota-1', folio: 'TJ260801AP01' },
        { id: 'nota-2', folio: 'TJ260802AP03' },
      ]),
    ).toEqual([
      { notaId: 'nota-2', folio: 'TJ260802AP03', montoCentavos: 10000, saldoDespuesCentavos: 0 },
      { notaId: 'nota-1', folio: 'TJ260801AP01', montoCentavos: 2000, saldoDespuesCentavos: 13000 },
    ]);
  });

  it('si la nota ya no esta en la lista, usa su id: nunca deja la linea vacia', () => {
    const reparto: Reparto = {
      aplicaciones: [
        { notaId: 'nota-x', montoCentavos: 500, saldoAntesCentavos: 500, saldoDespuesCentavos: 0, tipo: 'cobranza', status: 'pagada' },
      ],
      saldoFavorCentavos: 0,
    };
    expect(lineasDelCobro(reparto, [])[0]?.folio).toBe('nota-x');
  });
});
