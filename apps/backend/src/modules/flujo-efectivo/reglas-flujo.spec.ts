import { armarResumen, porcentajeCobro } from './reglas-flujo';

describe('porcentajeCobro', () => {
  it('redondea a 1 decimal, admite más de 100 y es null sin ventas', () => {
    expect(porcentajeCobro(87_500, 100_000)).toBe(87.5);
    expect(porcentajeCobro(1, 3)).toBe(33.3);
    expect(porcentajeCobro(150_000, 100_000)).toBe(150);
    expect(porcentajeCobro(5_000, 0)).toBeNull();
    expect(porcentajeCobro(0, 0)).toBeNull();
  });
});

describe('armarResumen', () => {
  it('suma ventas y cobros por tipo, encadena utilidades sin gastos y arma los días ordenados', () => {
    const r = armarResumen(
      [
        { fecha: '2026-10-02', ventasCentavos: 40_000 },
        { fecha: '2026-10-01', ventasCentavos: 60_000 },
      ],
      [
        { fecha: '2026-10-01', repartidor: true, montoCentavos: 30_000 },
        { fecha: '2026-10-01', repartidor: false, montoCentavos: 10_000 },
        { fecha: '2026-10-03', repartidor: true, montoCentavos: 5_000 },
      ],
      [],
    );
    expect(r).toMatchObject({
      ventasTotalesCentavos: 100_000,
      cobradoRepartidorCentavos: 35_000,
      cobradoOficinaCentavos: 10_000,
      ventasCobradasCentavos: 45_000,
      porcentajeCobro: 45,
      gastosDisponibles: true,
      gastosProduccionCentavos: 0,
      utilidadBrutaCentavos: 45_000,
      utilidadOperacionCentavos: 45_000,
      utilidadNetaCentavos: 45_000,
    });
    expect(r.dias).toEqual([
      {
        fecha: '2026-10-01',
        ventasCentavos: 60_000,
        cobradoRepartidorCentavos: 30_000,
        cobradoOficinaCentavos: 10_000,
        porcentajeCobro: 66.7,
      },
      {
        fecha: '2026-10-02',
        ventasCentavos: 40_000,
        cobradoRepartidorCentavos: 0,
        cobradoOficinaCentavos: 0,
        porcentajeCobro: 0,
      },
      {
        fecha: '2026-10-03',
        ventasCentavos: 0,
        cobradoRepartidorCentavos: 5_000,
        cobradoOficinaCentavos: 0,
        porcentajeCobro: null,
      },
    ]);
  });

  it('sin nada, todo en cero y sin días', () => {
    expect(armarResumen([], [], [])).toMatchObject({
      ventasTotalesCentavos: 0,
      porcentajeCobro: null,
      dias: [],
    });
  });

  it('gastos por tipo y utilidades encadenadas (T-30/T-31)', () => {
    const r = armarResumen(
      [{ fecha: '2026-10-14', ventasCentavos: 100_000 }],
      [{ fecha: '2026-10-14', repartidor: true, montoCentavos: 80_000 }],
      [
        { tipo: 'produccion', montoCentavos: 10_000 },
        { tipo: 'operacion', montoCentavos: 5_000 },
        { tipo: 'operacion', montoCentavos: 2_500 },
        { tipo: 'financiero', montoCentavos: 1_000 },
      ],
    );
    expect(r).toMatchObject({
      gastosDisponibles: true,
      gastosProduccionCentavos: 10_000,
      gastosOperacionCentavos: 7_500,
      gastosFinancierosCentavos: 1_000,
      utilidadBrutaCentavos: 70_000,
      utilidadOperacionCentavos: 62_500,
      utilidadNetaCentavos: 61_500,
    });
  });

  it('los gastos pueden dejar la utilidad en negativo', () => {
    const r = armarResumen(
      [],
      [],
      [{ tipo: 'operacion', montoCentavos: 3_000 }],
    );
    expect(r.utilidadNetaCentavos).toBe(-3_000);
  });
});
