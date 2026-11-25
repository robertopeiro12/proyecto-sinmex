import {
  actualDelDia,
  ordenarRecargasPorPresentacion,
  porProductoRecargas,
  SIN_MOVIMIENTOS_RECARGAS,
  sumarMovimientosRecargas,
  type MovimientosRecargas,
  type RenglonPtRecargas,
} from './reglas-inventario-pt-recargas';

const mov = (
  parcial: Partial<MovimientosRecargas> = {},
): MovimientosRecargas => ({ ...SIN_MOVIMIENTOS_RECARGAS, ...parcial });

const A = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const B = '3f2504e0-4f89-41d3-9a0c-0305e82c3302';
const C = '3f2504e0-4f89-41d3-9a0c-0305e82c3303';

const renglon = (parcial: Partial<RenglonPtRecargas>): RenglonPtRecargas => ({
  presentacionId: A,
  productoId: 'h',
  producto: 'Horchata',
  volumen: '1 L',
  ...SIN_MOVIMIENTOS_RECARGAS,
  inicial: 0,
  actual: 0,
  ajustado: false,
  ...parcial,
});

describe('actualDelDia (D2)', () => {
  it('el ejemplo del Excel: Inicial 3022, Recargas 1022, Envíos 1000 → 1000', () => {
    expect(actualDelDia(3022, mov({ recargas: 1022, envios: 1000 }))).toBe(
      1000,
    );
  });

  it('Actual = Inicial − Recargas − Envíos + Entradas (tío, 2026-11-25)', () => {
    const m = mov({ recargas: 10, envios: 20, entradas: 100 });
    expect(actualDelDia(500, m)).toBe(500 - 10 - 20 + 100);
  });

  it('solo lleva recargas, envíos y entradas (sin merma, consumo ni descuentos)', () => {
    expect(Object.keys(SIN_MOVIMIENTOS_RECARGAS).sort()).toEqual([
      'entradas',
      'envios',
      'recargas',
    ]);
  });

  it('sin Inicial, el Actual queda vacío (nunca 0)', () => {
    expect(actualDelDia(null, mov({ entradas: 50 }))).toBeNull();
  });

  it('puede quedar negativo (no se recorta)', () => {
    expect(actualDelDia(5, mov({ recargas: 8 }))).toBe(-3);
  });
});

describe('sumarMovimientosRecargas', () => {
  it('suma columna por columna', () => {
    expect(
      sumarMovimientosRecargas(
        mov({ recargas: 1, envios: 2, entradas: 3 }),
        mov({ recargas: 10, entradas: 4 }),
      ),
    ).toEqual({ recargas: 11, envios: 2, entradas: 7 });
  });
});

describe('porProductoRecargas', () => {
  it('un renglón por producto: suma movimientos, Inicial y Actual; ordena por nombre', () => {
    const r = porProductoRecargas([
      renglon({
        presentacionId: A,
        productoId: 'h',
        producto: 'Horchata',
        recargas: 2,
        inicial: 10,
        actual: 8,
        ajustado: true,
      }),
      renglon({
        presentacionId: B,
        productoId: 'h',
        producto: 'Horchata',
        volumen: '500 ml',
        envios: 3,
        inicial: 5,
        actual: 2,
      }),
      renglon({
        presentacionId: C,
        productoId: 'j',
        producto: 'Jamaica',
        entradas: 1,
        inicial: 4,
        actual: 3,
      }),
    ]);
    expect(r).toEqual([
      expect.objectContaining({
        presentacionId: null,
        productoId: 'h',
        producto: 'Horchata',
        volumen: '',
        recargas: 2,
        envios: 3,
        inicial: 15,
        actual: 10,
        ajustado: false,
      }),
      expect.objectContaining({
        productoId: 'j',
        producto: 'Jamaica',
        entradas: 1,
        inicial: 4,
        actual: 3,
        ajustado: false,
      }),
    ]);
  });

  it('una presentación sin Inicial deja vacío el total del producto, con sus movimientos', () => {
    const [h] = porProductoRecargas([
      renglon({ presentacionId: A, inicial: 10, actual: 9, recargas: 1 }),
      renglon({ presentacionId: B, inicial: null, actual: null, recargas: 4 }),
    ]);
    expect(h).toMatchObject({ inicial: null, actual: null, recargas: 5 });
  });
});

describe('ordenarRecargasPorPresentacion', () => {
  it('por tamaño (mililitros), luego producto', () => {
    const r = ordenarRecargasPorPresentacion([
      renglon({ presentacionId: A, producto: 'Jamaica', volumen: '1 L' }),
      renglon({ presentacionId: B, producto: 'Horchata', volumen: '1 L' }),
      renglon({ presentacionId: C, producto: 'Horchata', volumen: '500 ml' }),
    ]);
    expect(r.map((x) => x.presentacionId)).toEqual([C, B, A]);
  });
});
