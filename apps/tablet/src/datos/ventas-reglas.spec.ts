import {
  leerCantidad,
  MAX_LINEAS_VENTA,
  problemasDeCaptura,
  resumirCaptura,
  type CapturaVenta,
  type LineaCaptura,
} from './ventas-reglas';

const linea = (extra: Partial<LineaCaptura> = {}): LineaCaptura => ({
  presentacionId: 'pre-1',
  etiqueta: 'Jamaica 1 L',
  cantidad: 24,
  cantidadPromocion: 2,
  precioCentavos: 2800,
  ...extra,
});

const captura = (extra: Partial<CapturaVenta> = {}): CapturaVenta => ({
  numNota: '2346',
  contadoCredito: 'credito',
  comentarios: '',
  lineas: [linea()],
  ...extra,
});

describe('leerCantidad', () => {
  it.each<[string, number | null]>([
    ['', 0],
    ['24', 24],
    [' 3 ', 3],
    ['-1', null],
    ['1.5', null],
    ['abc', null],
  ])('%p se lee como %p', (texto, esperado) => {
    expect(leerCantidad(texto)).toBe(esperado);
  });
});

describe('resumirCaptura', () => {
  it('calcula importe por linea y total; la promocion no suma al importe', () => {
    const r = resumirCaptura([
      linea(),
      linea({
        presentacionId: 'pre-3',
        etiqueta: 'Horchata 1 L',
        cantidad: 3,
        cantidadPromocion: 0,
        precioCentavos: 1010,
      }),
    ]);
    expect(r.lineas.map((l) => l.importeCentavos)).toEqual([67200, 3030]);
    expect(r.totalCentavos).toBe(70230);
    expect(r.piezas).toBe(27);
    expect(r.piezasPromocion).toBe(2);
  });

  it('deja fuera las filas vacias, y una fila de pura promocion sin precio importa 0', () => {
    const r = resumirCaptura([
      linea({ cantidad: 0, cantidadPromocion: 0 }),
      linea({
        presentacionId: 'pre-2',
        etiqueta: 'Jamaica 500 ml',
        cantidad: 0,
        cantidadPromocion: 3,
        precioCentavos: null,
      }),
    ]);
    expect(r.lineas.map((l) => l.presentacionId)).toEqual(['pre-2']);
    expect(r.totalCentavos).toBe(0);
    expect(r.piezasPromocion).toBe(3);
  });
});

describe('problemasDeCaptura', () => {
  it('una captura completa no tiene problemas', () => {
    expect(problemasDeCaptura(captura())).toEqual([]);
  });

  it('sin nada capturado no se puede grabar', () => {
    expect(
      problemasDeCaptura(captura({ lineas: [linea({ cantidad: 0, cantidadPromocion: 0 })] })),
    ).toContain('Captura al menos una cantidad o una pieza de promoción.');
  });

  it('vender una presentacion sin precio para el cliente no se puede (D15)', () => {
    expect(problemasDeCaptura(captura({ lineas: [linea({ precioCentavos: null })] }))).toEqual([
      'Jamaica 1 L no tiene precio para este cliente: solo se puede regalar como promoción.',
    ]);
  });

  it('un precio de 0 cuenta como sin precio: el servidor no acepta piezas vendidas a $0', () => {
    expect(problemasDeCaptura(captura({ lineas: [linea({ precioCentavos: 0 })] }))).toHaveLength(
      1,
    );
  });

  it('regalar piezas de una presentacion sin precio si se puede (D13)', () => {
    expect(
      problemasDeCaptura(
        captura({
          lineas: [linea({ cantidad: 0, cantidadPromocion: 3, precioCentavos: null })],
        }),
      ),
    ).toEqual([]);
  });

  it('falta el numero de nota', () => {
    expect(problemasDeCaptura(captura({ numNota: '   ' }))).toEqual([
      'Falta el número de la nota física.',
    ]);
  });

  it('el numero de nota lleva hasta 30 caracteres', () => {
    expect(problemasDeCaptura(captura({ numNota: '1'.repeat(31) }))).toEqual([
      'El número de nota lleva hasta 30 caracteres.',
    ]);
  });

  it('hay que elegir contado o credito', () => {
    expect(problemasDeCaptura(captura({ contadoCredito: null }))).toEqual([
      'Elige si la venta es de contado o a crédito.',
    ]);
  });

  it('los comentarios llevan hasta 500 caracteres', () => {
    expect(problemasDeCaptura(captura({ comentarios: 'x'.repeat(501) }))).toEqual([
      'Los comentarios llevan hasta 500 caracteres.',
    ]);
  });

  it(`una venta lleva hasta ${MAX_LINEAS_VENTA} productos`, () => {
    const lineas = Array.from({ length: MAX_LINEAS_VENTA + 1 }, (_, i) =>
      linea({ presentacionId: `pre-${i}`, etiqueta: `Producto ${i}` }),
    );
    expect(problemasDeCaptura(captura({ lineas }))).toEqual([
      `Una venta lleva hasta ${MAX_LINEAS_VENTA} productos.`,
    ]);
  });

  it('una cantidad ilegible (lo que leerCantidad deja en null) se señala en su linea', () => {
    expect(problemasDeCaptura(captura({ lineas: [linea({ cantidad: Number.NaN })] }))).toContain(
      'Jamaica 1 L: las cantidades son piezas enteras.',
    );
  });
});
