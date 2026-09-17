import {
  esConflictoDeConcurrencia,
  esViolacionFk,
  esViolacionUnicidad,
} from './errores-postgres';

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

describe('esConflictoDeConcurrencia', () => {
  it('reconoce 40P01 (deadlock_detected) y 40001 (serialization_failure)', () => {
    expect(esConflictoDeConcurrencia({ code: '40P01' })).toBe(true);
    expect(esConflictoDeConcurrencia({ code: '40001' })).toBe(true);
  });

  it('rechaza otros codigos', () => {
    expect(esConflictoDeConcurrencia({ code: '23505' })).toBe(false);
    expect(esConflictoDeConcurrencia({ code: '23503' })).toBe(false);
  });

  it('rechaza un error sin codigo', () => {
    expect(esConflictoDeConcurrencia(new Error('algo'))).toBe(false);
    expect(esConflictoDeConcurrencia(null)).toBe(false);
  });
});
