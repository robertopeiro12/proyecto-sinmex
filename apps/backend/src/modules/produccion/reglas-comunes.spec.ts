import { esFechaReal } from './reglas-comunes';

describe('esFechaReal', () => {
  it('acepta un dia del calendario y rechaza uno que no existe o mal formado', () => {
    expect(esFechaReal('2024-02-29')).toBe(true);
    expect(esFechaReal('2026-02-29')).toBe(false);
    expect(esFechaReal('2026-13-01')).toBe(false);
    expect(esFechaReal('2026-1-5')).toBe(false);
    expect(esFechaReal(20260105)).toBe(false);
  });
});
