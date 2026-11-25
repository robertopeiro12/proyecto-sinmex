import { creadaEnDelDetalle } from './creada-en';

describe('creadaEnDelDetalle (recorrido final, D2)', () => {
  it('con operacion de sync: la hora de la venta en la tablet, ISO en UTC', () => {
    expect(
      creadaEnDelDetalle(new Date('2026-11-25T13:09:00.000Z'), '2026-11-25'),
    ).toBe('2026-11-25T13:09:00.000Z');
  });

  it('acepta el timestamptz como cadena', () => {
    expect(creadaEnDelDetalle('2026-11-25 05:09:00-08', '2026-11-25')).toBe(
      '2026-11-25T13:09:00.000Z',
    );
  });

  it('sin operacion (nota de la oficina): solo la fecha de la nota, sin hora', () => {
    expect(creadaEnDelDetalle(null, '2026-10-25')).toBe('2026-10-25');
  });
});
