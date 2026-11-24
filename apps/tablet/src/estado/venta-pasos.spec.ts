import type { CatalogoPromociones, PromocionAplicable } from '@/datos/promociones-reglas';

import {
  alternarTodas,
  checklistPromociones,
  opcionesCobranza,
  pasoAnterior,
  presentacionPorOmision,
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
