import {
  diasEntre,
  finalDelDia,
  inicioDeSerie,
  porProducto,
  serie,
  SIN_MOVIMIENTOS,
  sumarRenglones,
  validarAjustes,
  type MovimientosDia,
  type RenglonPt,
} from './reglas-inventario-pt';

const mov = (parcial: Partial<MovimientosDia> = {}): MovimientosDia => ({
  ...SIN_MOVIMIENTOS,
  ...parcial,
});

const A = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const B = '3f2504e0-4f89-41d3-9a0c-0305e82c3302';
const C = '3f2504e0-4f89-41d3-9a0c-0305e82c3303';

const renglon = (parcial: Partial<RenglonPt>): RenglonPt => ({
  presentacionId: A,
  productoId: 'p1',
  producto: 'Horchata',
  volumen: '1 L',
  ...SIN_MOVIMIENTOS,
  inicial: 0,
  final: 0,
  mermaAcumulada: 0,
  ajustado: false,
  ...parcial,
});

describe('finalDelDia (D2)', () => {
  it('Final = Inicial − Ventas − Merma − Consumo − Promo − Descuentos + Cambios + Entradas − Envíos', () => {
    const m = mov({
      ventas: 10,
      merma: 2,
      consumo: 1,
      promo: 3,
      descuentos: 4,
      cambios: -1,
      entradas: 50,
      envios: 5,
      retiroMerma: 7, // no toca el Final
    });
    expect(finalDelDia(100, m)).toBe(100 - 10 - 2 - 1 - 3 - 4 - 1 + 50 - 5);
  });

  it('sin Inicial no hay Final (null, nunca 0)', () => {
    expect(finalDelDia(null, mov({ entradas: 5 }))).toBeNull();
  });
});

describe('diasEntre', () => {
  it('incluye los dos extremos y cruza meses', () => {
    expect(diasEntre('2026-10-30', '2026-11-02')).toEqual([
      '2026-10-30',
      '2026-10-31',
      '2026-11-01',
      '2026-11-02',
    ]);
    expect(diasEntre('2026-11-02', '2026-11-01')).toEqual([]);
  });
});

describe('inicioDeSerie', () => {
  it('arranca en el ajuste más reciente que no pase de `desde`; sin él, en `desde`', () => {
    const ajustes = [
      { fecha: '2026-11-01', inventarioInicial: 1, mermaAcumuladaInicial: 0 },
      { fecha: '2026-11-05', inventarioInicial: 1, mermaAcumuladaInicial: 0 },
      { fecha: '2026-11-20', inventarioInicial: 1, mermaAcumuladaInicial: 0 },
    ];
    expect(inicioDeSerie(ajustes, '2026-11-10')).toBe('2026-11-05');
    expect(inicioDeSerie(ajustes, '2026-11-05')).toBe('2026-11-05');
    expect(inicioDeSerie(ajustes, '2026-10-01')).toBe('2026-10-01');
    expect(inicioDeSerie([], '2026-10-01')).toBe('2026-10-01');
  });
});

describe('serie (encadenado, D2 y D3)', () => {
  it('encadena: el Inicial de cada día es el Final del anterior', () => {
    const movs = new Map([
      ['2026-11-01', mov({ ventas: 10 })],
      ['2026-11-02', mov({ entradas: 20, ventas: 5 })],
      // 2026-11-03 sin movimientos
      ['2026-11-04', mov({ envios: 3 })],
    ]);
    const dias = serie(
      [
        {
          fecha: '2026-11-01',
          inventarioInicial: 100,
          mermaAcumuladaInicial: 0,
        },
      ],
      movs,
      '2026-11-01',
      '2026-11-04',
    );
    expect(dias.map((d) => [d.fecha, d.inicial, d.final])).toEqual([
      ['2026-11-01', 100, 90],
      ['2026-11-02', 90, 105],
      ['2026-11-03', 105, 105],
      ['2026-11-04', 105, 102],
    ]);
    expect(dias.map((d) => d.ajustado)).toEqual([true, false, false, false]);
    expect(dias[1].entradas).toBe(20);
  });

  it('solo devuelve [desde, hasta] aunque arranque en un ajuste anterior', () => {
    const movs = new Map([
      ['2026-11-01', mov({ ventas: 10 })],
      ['2026-11-02', mov({ ventas: 1 })],
      ['2026-11-03', mov({ ventas: 2 })],
    ]);
    const dias = serie(
      [
        {
          fecha: '2026-11-01',
          inventarioInicial: 100,
          mermaAcumuladaInicial: 0,
        },
      ],
      movs,
      '2026-11-03',
      '2026-11-03',
    );
    expect(dias).toHaveLength(1);
    expect(dias[0]).toMatchObject({
      fecha: '2026-11-03',
      inicial: 89,
      final: 87,
      ventas: 2,
      ajustado: false,
    });
  });

  it('Review Focus 2: un ajuste a media serie reemplaza el Inicial de ese día; el día anterior no cambia', () => {
    const movs = new Map([
      ['2026-11-01', mov({ ventas: 10, merma: 2 })],
      ['2026-11-02', mov({ ventas: 5, merma: 1 })],
      ['2026-11-03', mov({ ventas: 4, retiroMerma: 3 })],
    ]);
    const sinAjuste = serie(
      [
        {
          fecha: '2026-11-01',
          inventarioInicial: 100,
          mermaAcumuladaInicial: 6,
        },
      ],
      movs,
      '2026-11-01',
      '2026-11-03',
    );
    const conAjuste = serie(
      [
        {
          fecha: '2026-11-01',
          inventarioInicial: 100,
          mermaAcumuladaInicial: 6,
        },
        {
          fecha: '2026-11-02',
          inventarioInicial: 50,
          mermaAcumuladaInicial: 0,
        },
      ],
      movs,
      '2026-11-01',
      '2026-11-03',
    );
    expect(conAjuste[0]).toEqual(sinAjuste[0]);
    expect(conAjuste[0]).toMatchObject({
      inicial: 100,
      final: 88,
      mermaAcumulada: 8,
    });
    expect(conAjuste[1]).toMatchObject({
      inicial: 50,
      final: 44,
      mermaAcumulada: 1,
      ajustado: true,
    });
    expect(conAjuste[2]).toMatchObject({
      inicial: 44,
      final: 40,
      mermaAcumulada: -2,
      ajustado: false,
    });
  });

  it('merma acumulada = la del día anterior + Merma − Retiro', () => {
    const movs = new Map([
      ['2026-11-01', mov({ merma: 4 })],
      ['2026-11-02', mov({ merma: 3, retiroMerma: 5 })],
      ['2026-11-03', mov({ retiroMerma: 1 })],
    ]);
    const dias = serie(
      [
        {
          fecha: '2026-11-01',
          inventarioInicial: 0,
          mermaAcumuladaInicial: 10,
        },
      ],
      movs,
      '2026-11-01',
      '2026-11-03',
    );
    expect(dias.map((d) => d.mermaAcumulada)).toEqual([14, 12, 11]);
  });

  it('Review Focus 5: sin ningún ajuste anterior, movimientos sí pero Inicial, Final y Merma acumulada null', () => {
    const movs = new Map([['2026-11-02', mov({ ventas: 7, merma: 1 })]]);
    const dias = serie([], movs, '2026-11-01', '2026-11-02');
    expect(dias[1]).toMatchObject({
      ventas: 7,
      merma: 1,
      inicial: null,
      final: null,
      mermaAcumulada: null,
      ajustado: false,
    });
  });

  it('un ajuste posterior a `desde` deja null hasta su día y arranca ahí', () => {
    const movs = new Map([['2026-11-01', mov({ ventas: 7 })]]);
    const dias = serie(
      [
        {
          fecha: '2026-11-02',
          inventarioInicial: 30,
          mermaAcumuladaInicial: 2,
        },
      ],
      movs,
      '2026-11-01',
      '2026-11-03',
    );
    expect(dias.map((d) => [d.inicial, d.final, d.mermaAcumulada])).toEqual([
      [null, null, null],
      [30, 30, 2],
      [30, 30, 2],
    ]);
  });
});

describe('sumarRenglones (Todas y por producto)', () => {
  it('suma movimientos, Inicial, Final y Merma acumulada', () => {
    const r = sumarRenglones([
      renglon({
        ventas: 2,
        entradas: 5,
        inicial: 10,
        final: 13,
        mermaAcumulada: 1,
      }),
      renglon({
        ventas: 1,
        envios: 5,
        inicial: 20,
        final: 14,
        mermaAcumulada: 2,
      }),
    ]);
    expect(r).toMatchObject({
      ventas: 3,
      entradas: 5,
      envios: 5,
      inicial: 30,
      final: 27,
      mermaAcumulada: 3,
      ajustado: false,
    });
  });

  it('null se propaga: si una parte no tiene inventario inicial, el total tampoco', () => {
    const r = sumarRenglones([
      renglon({ ventas: 2, inicial: 10, final: 8, mermaAcumulada: 0 }),
      renglon({ ventas: 1, inicial: null, final: null, mermaAcumulada: null }),
    ]);
    expect(r).toMatchObject({
      ventas: 3,
      inicial: null,
      final: null,
      mermaAcumulada: null,
    });
  });

  it('ajustado si alguna parte se ajustó ese día', () => {
    expect(
      sumarRenglones([renglon({}), renglon({ ajustado: true })]).ajustado,
    ).toBe(true);
  });
});

describe('porProducto', () => {
  it('un renglón por producto sumando sus presentaciones, por nombre de producto', () => {
    const r = porProducto([
      renglon({
        presentacionId: A,
        productoId: 'h',
        producto: 'Horchata',
        volumen: '1 L',
        ventas: 2,
        inicial: 5,
        final: 3,
      }),
      renglon({
        presentacionId: B,
        productoId: 'h',
        producto: 'Horchata',
        volumen: '500 ml',
        ventas: 4,
        inicial: 10,
        final: 6,
      }),
      renglon({
        presentacionId: C,
        productoId: 'a',
        producto: 'Agua',
        volumen: '1 L',
        ventas: 1,
        inicial: null,
        final: null,
        mermaAcumulada: null,
      }),
    ]);
    expect(
      r.map((x) => [x.producto, x.productoId, x.presentacionId, x.volumen]),
    ).toEqual([
      ['Agua', 'a', null, ''],
      ['Horchata', 'h', null, ''],
    ]);
    expect(r[1]).toMatchObject({ ventas: 6, inicial: 15, final: 9 });
    expect(r[0].final).toBeNull();
  });
});

describe('validarAjustes (D3)', () => {
  const ok = {
    fecha: '2026-11-20',
    renglones: [
      { presentacionId: A, inventarioInicial: 10, mermaAcumuladaInicial: 0 },
    ],
  };
  it('válido', () => {
    expect(validarAjustes(ok, '2026-11-25')).toEqual([]);
  });
  it('fecha futura o inválida', () => {
    expect(
      validarAjustes({ ...ok, fecha: '2026-11-26' }, '2026-11-25'),
    ).toEqual(['La fecha no puede ser posterior a hoy.']);
    expect(
      validarAjustes({ ...ok, fecha: '2026-02-30' }, '2026-11-25'),
    ).toEqual(['La fecha no es válida.']);
  });
  it('sin renglones, negativos o repetidos', () => {
    expect(validarAjustes({ ...ok, renglones: [] }, '2026-11-25')).toEqual([
      'Captura al menos una presentación.',
    ]);
    expect(
      validarAjustes(
        {
          ...ok,
          renglones: [
            {
              presentacionId: A,
              inventarioInicial: -1,
              mermaAcumuladaInicial: 0,
            },
          ],
        },
        '2026-11-25',
      ),
    ).toEqual([
      'El inventario inicial y la merma acumulada deben ser números enteros mayores o iguales a 0.',
    ]);
    expect(
      validarAjustes(
        { ...ok, renglones: [...ok.renglones, ...ok.renglones] },
        '2026-11-25',
      ),
    ).toEqual(['Una presentación viene repetida.']);
  });
});
