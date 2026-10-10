import { RE_FOLIO, partirFolio } from '../sincronizacion/folio';
import { FoliosOficinaAgotados, folioDeOficina } from './folio-oficina';

describe('folio de oficina (T-17, §4.4)', () => {
  it('es el formato de ADR-0001 con OF en el segmento de vendedor', () => {
    expect(folioDeOficina('TJ', '2026-10-06', 1)).toBe('TJ261006OF01');
    expect(folioDeOficina('MX', '2026-10-06', 99)).toBe('MX261006OF99');
  });

  it('se lee con el mismo parser que los folios de tablet', () => {
    const folio = folioDeOficina('TJ', '2026-10-06', 7);
    expect(folio).toMatch(RE_FOLIO);
    expect(partirFolio(folio)).toMatchObject({
      sucursal: 'TJ',
      fecha: '2026-10-06',
      vendedor: 'OF',
      consecutivo: 7,
    });
  });

  it.each([0, 100, 1.5])(
    'un consecutivo %p es un bug de quien llama, no un folio',
    (consecutivo) => {
      expect(() => folioDeOficina('TJ', '2026-10-06', consecutivo)).toThrow(
        RangeError,
      );
    },
  );

  it('el tope de 99 por dia y sucursal se explica en espanol', () => {
    const error = new FoliosOficinaAgotados('2026-10-06');
    expect(error.message).toBe(
      'Se alcanzó el máximo de 99 ventas de oficina para ese día.',
    );
    expect(error.fecha).toBe('2026-10-06');
  });
});
