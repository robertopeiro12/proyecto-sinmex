import { inicioDelAnioEnTijuana } from './reglas-campo-egreso';

describe('inicioDelAnioEnTijuana (T-30, D2)', () => {
  it('a media tarde es el 1 de enero del mismo año', () => {
    expect(inicioDelAnioEnTijuana(new Date('2026-10-20T20:00:00Z'))).toBe(
      '2026-01-01',
    );
  });

  it('el 1 de enero a las 07:30 UTC en Tijuana todavia es 31 de diciembre', () => {
    // Tijuana en invierno es UTC-8: 2027-01-01T07:30Z = 2026-12-31 23:30.
    expect(inicioDelAnioEnTijuana(new Date('2027-01-01T07:30:00Z'))).toBe(
      '2026-01-01',
    );
  });

  it('una hora despues ya es el año nuevo en Tijuana', () => {
    expect(inicioDelAnioEnTijuana(new Date('2027-01-01T08:30:00Z'))).toBe(
      '2027-01-01',
    );
  });
});
