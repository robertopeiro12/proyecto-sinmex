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
  it('suma ventas y cobros por tipo, encadena utilidades con gastos en 0 y arma los días ordenados', () => {
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
    );
    expect(r).toMatchObject({
      ventasTotalesCentavos: 100_000,
      cobradoRepartidorCentavos: 35_000,
      cobradoOficinaCentavos: 10_000,
      ventasCobradasCentavos: 45_000,
      porcentajeCobro: 45,
      gastosDisponibles: false,
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
    expect(armarResumen([], [])).toMatchObject({
      ventasTotalesCentavos: 0,
      porcentajeCobro: null,
      dias: [],
    });
  });
});
