import { esCoordenadaValida } from './coordenada';

describe('esCoordenadaValida (T-39 D7, T-72 D1)', () => {
  it('una coordenada de Tijuana y los bordes de la Tierra son validos', () => {
    expect(esCoordenadaValida(32.5149, -117.0382)).toBe(true);
    expect(esCoordenadaValida(0, 0)).toBe(true);
    expect(esCoordenadaValida(90, 180)).toBe(true);
    expect(esCoordenadaValida(-90, -180)).toBe(true);
  });

  it.each([
    [Number.NaN, -117],
    [32.5, Number.NaN],
    [Number.POSITIVE_INFINITY, -117],
    [32.5, Number.NEGATIVE_INFINITY],
    [90.0001, -117],
    [-91, -117],
    [32.5, 180.5],
    [32.5, -181],
  ])('(%p, %p) no es valida: cuenta como sin GPS', (lat, lng) => {
    expect(esCoordenadaValida(lat, lng)).toBe(false);
  });
});
