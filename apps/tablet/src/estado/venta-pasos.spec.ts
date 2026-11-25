import type { CatalogoPromociones, PromocionAplicable } from '@/datos/promociones-reglas';

import {
  alternarTodas,
  checklistPromociones,
  opcionesCobranza,
  pasoAnterior,
  filasNota,
  presentacionPorOmision,
  promocionesSinRenglon,
  primerPaso,
  renglonesVenta,
  teclear,
  textoSaldoPendiente,
  validarCobranzaVenta,
} from './venta-pasos';

const promo = (id: string) => ({ id, texto: `promo ${id}` }) as unknown as PromocionAplicable;

describe('pasos de la venta', () => {
  it('primerPaso y pasoAnterior', () => {
    expect(primerPaso(true)).toBe('promociones');
    expect(primerPaso(false)).toBe('lista');
    expect(pasoAnterior('promociones', true)).toBeNull();
    expect(pasoAnterior('lista', false)).toBeNull();
    expect(pasoAnterior('lista', true)).toBe('promociones');
    expect(pasoAnterior('cobranza', true)).toBe('lista');
    expect(pasoAnterior('cobranza', false)).toBe('lista');
    expect(pasoAnterior('grabada', true)).toBeNull();
  });
});

describe('checklist de promociones', () => {
  const ps = [promo('a'), promo('b'), promo('c')];
  it('cuenta las palomeadas', () => {
    expect(checklistPromociones(ps, new Set(['b']))).toEqual({ todas: false, palomeadas: 2, total: 3 });
    expect(checklistPromociones(ps, new Set())).toEqual({ todas: true, palomeadas: 3, total: 3 });
  });
  it('alternarTodas', () => {
    expect(alternarTodas(ps, new Set(['b']))).toEqual(new Set());
    expect(alternarTodas(ps, new Set())).toEqual(new Set(['a', 'b', 'c']));
  });
});

describe('presentacionPorOmision', () => {
  const catalogo: CatalogoPromociones = {
    presentaciones: new Map([
      ['p1', { productoId: 'x', etiqueta: 'X 1 L' }],
      ['p2', { productoId: 'y', etiqueta: 'Y 1 L' }],
      ['p3', { productoId: 'y', etiqueta: 'Y 2 L' }],
    ]),
    productos: new Map(),
  };
  it('la primera del producto', () => {
    expect(presentacionPorOmision('y', catalogo)).toBe('p2');
    expect(presentacionPorOmision('z', catalogo)).toBeNull();
  });

  it('con control de inventario, la primera del producto que el vendedor trae', () => {
    const inventario = { controlInventario: true, existencias: new Map([['p2', { existencia: 0 }], ['p3', { existencia: 4 }]]) };
    expect(presentacionPorOmision('y', catalogo, inventario)).toBe('p3');
  });

  it('con control y ninguna con existencia, la primera del catalogo', () => {
    const inventario = { controlInventario: true, existencias: new Map([['p2', { existencia: 0 }]]) };
    expect(presentacionPorOmision('y', catalogo, inventario)).toBe('p2');
    expect(presentacionPorOmision('z', catalogo, inventario)).toBeNull();
  });

  it('sin control de inventario, la primera del catalogo aunque no haya existencia', () => {
    const inventario = { controlInventario: false, existencias: new Map([['p3', { existencia: 4 }]]) };
    expect(presentacionPorOmision('y', catalogo, inventario)).toBe('p2');
    expect(presentacionPorOmision('y', catalogo, null)).toBe('p2');
  });
});

describe('promocionesSinRenglon', () => {
  it('pinta de solo lectura las piezas de promocion sin renglon en la lista', () => {
    const lineas = [
      { presentacionId: 'h1', etiqueta: 'Horchata 1 L', cantidadPromocion: 1 },
      { presentacionId: 'j1', etiqueta: 'Jamaica 1 L', cantidadPromocion: 2 },
      { presentacionId: 'a1', etiqueta: 'Agua 1 L', cantidadPromocion: 0 },
    ];
    expect(promocionesSinRenglon(lineas, [])).toEqual([
      { presentacionId: 'h1', texto: '1 × Horchata 1 L · promoción' },
      { presentacionId: 'j1', texto: '2 × Jamaica 1 L · promoción' },
    ]);
    // La que tiene renglon ya dice "+N de promoción" ahi.
    expect(promocionesSinRenglon(lineas, [{ presentacionId: 'j1' }])).toEqual([
      { presentacionId: 'h1', texto: '1 × Horchata 1 L · promoción' },
    ]);
  });
});

describe('filasNota', () => {
  it('primero lo cobrado en el orden de la lista; despues la promocion', () => {
    const lineas = [
      { presentacionId: 'h1', etiqueta: 'Horchata 1 L', cantidad: 0, cantidadPromocion: 1, importeCentavos: 0 },
      { presentacionId: 'j5', etiqueta: 'Jamaica 500 ml', cantidad: 3, cantidadPromocion: 0, importeCentavos: 3000 },
      { presentacionId: 'a1', etiqueta: 'Agua 1 L', cantidad: 2, cantidadPromocion: 1, importeCentavos: 1800 },
    ];
    expect(filasNota(lineas, ['a1', 'j5'])).toEqual([
      { clave: 'a1-v', texto: '2 × Agua 1 L', importeCentavos: 1800 },
      { clave: 'j5-v', texto: '3 × Jamaica 500 ml', importeCentavos: 3000 },
      { clave: 'a1-p', texto: '1 × Agua 1 L (promoción)', importeCentavos: 0 },
      { clave: 'h1-p', texto: '1 × Horchata 1 L (promoción)', importeCentavos: 0 },
    ]);
  });
});

describe('renglonesVenta', () => {
  const presentaciones = [
    { presentacionId: 'c5', etiqueta: 'Cebada · 500 ml', precioCentavos: 1000 },
    { presentacionId: 'a1', etiqueta: 'Arándano · 1 L', precioCentavos: 2000 },
    { presentacionId: 'a5', etiqueta: 'Arándano · 500 ml', precioCentavos: 1100 },
    { presentacionId: 'sp', etiqueta: 'Anís · 1 L', precioCentavos: null },
    { presentacionId: 'ag', etiqueta: 'Agua · 1 L', precioCentavos: 900 },
  ];
  const existencias = new Map([
    ['c5', { existencia: 4 }],
    ['a1', { existencia: 0 }],
    ['a5', { existencia: 2 }],
    ['sp', { existencia: 9 }],
    ['ag', { existencia: 1 }],
  ]);
  it('con control: solo con precio y existencia', () => {
    const r = renglonesVenta({ presentaciones, existencias, controlInventario: true });
    expect(r.map((x) => x.etiqueta)).toEqual(['Agua · 1 L', 'Arándano · 500 ml', 'Cebada · 500 ml']);
    expect(r.map((x) => x.quedan)).toEqual([1, 2, 4]);
  });
  it('sin control: todas con precio y quedan null; 500 ml antes que 1 L', () => {
    const r = renglonesVenta({ presentaciones, existencias, controlInventario: false });
    expect(r.map((x) => x.etiqueta)).toEqual([
      'Agua · 1 L',
      'Arándano · 500 ml',
      'Arándano · 1 L',
      'Cebada · 500 ml',
    ]);
    expect(r.every((x) => x.quedan === null)).toBe(true);
  });
  it('sin existencia registrada con control: no sale', () => {
    expect(renglonesVenta({ presentaciones, existencias: new Map(), controlInventario: true })).toEqual([]);
  });
});

describe('teclear', () => {
  it.each<[string, Parameters<typeof teclear>[1], number | null, string]>([
    ['', '6', 20, '6'],
    ['6', '5', 20, '20'],
    ['0', '4', null, '4'],
    ['', '0', null, ''],
    ['12', 'borrar', null, '1'],
    ['1', 'borrar', null, ''],
    ['', 'borrar', null, ''],
    ['15', '3', 20, '20'],
  ])('teclear(%j, %j, %j) = %j', (a, t, m, esperado) => {
    expect(teclear(a, t, m)).toBe(esperado);
  });
});

describe('cobranza de la venta', () => {
  it('opcionesCobranza', () => {
    expect(opcionesCobranza(0)).toEqual(['liquidar']);
    expect(opcionesCobranza(80400)).toEqual(['liquidar', 'abonar', 'credito']);
  });
  const base = { abonoTexto: '', totalCentavos: 80400, atendio: 'Juan' };
  it('liquidar es contado', () => {
    expect(validarCobranzaVenta({ ...base, opcion: 'liquidar' })).toEqual({
      problemas: [],
      contadoCredito: 'contado',
      abonoCentavos: null,
    });
  });
  it('crédito', () => {
    expect(validarCobranzaVenta({ ...base, opcion: 'credito' })).toEqual({
      problemas: [],
      contadoCredito: 'credito',
      abonoCentavos: null,
    });
  });
  it('abonar 300 de 804', () => {
    expect(validarCobranzaVenta({ ...base, opcion: 'abonar', abonoTexto: '300.00' })).toEqual({
      problemas: [],
      contadoCredito: 'credito',
      abonoCentavos: 30000,
    });
  });
  it('abonar el total o más es problema; vacío también', () => {
    expect(validarCobranzaVenta({ ...base, opcion: 'abonar', abonoTexto: '804.00' }).problemas).toHaveLength(1);
    expect(validarCobranzaVenta({ ...base, opcion: 'abonar', abonoTexto: '900' }).problemas).toHaveLength(1);
    expect(validarCobranzaVenta({ ...base, opcion: 'abonar', abonoTexto: '' }).problemas).toHaveLength(1);
    expect(validarCobranzaVenta({ ...base, opcion: 'abonar', abonoTexto: '804' }).abonoCentavos).toBeNull();
  });
  it('atendió vacío', () => {
    expect(validarCobranzaVenta({ ...base, opcion: 'liquidar', atendio: ' ' }).problemas).toEqual([
      'Escribe el nombre de quien atiende.',
    ]);
  });
  it('textoSaldoPendiente', () => {
    expect(textoSaldoPendiente(50400)).toBe('Saldo pendiente por liquidar $504.00');
  });
});
