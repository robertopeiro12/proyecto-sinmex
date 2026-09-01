import { esViolacionFk, esViolacionUnicidad } from './errores-postgres';

describe('esViolacionUnicidad', () => {
  it('reconoce el codigo 23505', () => {
    expect(esViolacionUnicidad({ code: '23505' })).toBe(true);
  });

  it('rechaza otros codigos', () => {
    expect(esViolacionUnicidad({ code: '23503' })).toBe(false);
  });

  it('rechaza un error sin codigo', () => {
    expect(esViolacionUnicidad(new Error('algo'))).toBe(false);
    expect(esViolacionUnicidad(null)).toBe(false);
    expect(esViolacionUnicidad('texto')).toBe(false);
  });
});

describe('esViolacionFk', () => {
  it('reconoce el codigo 23503', () => {
    expect(esViolacionFk({ code: '23503' })).toBe(true);
  });

  it('rechaza otros codigos', () => {
    expect(esViolacionFk({ code: '23505' })).toBe(false);
  });
});
