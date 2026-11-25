import { firmaPorSubir } from './firma';

describe('firma de ventas viejas', () => {
  it('firma por subir: con firma local, sin subir y no descartada', () => {
    const base = { firma_local: 'file:///documentos/firmas/firma-v.jpg', firma_subida_en: null, firma_descartada: 0 as const };
    expect(firmaPorSubir(base)).toBe(true);
    expect(firmaPorSubir({ ...base, firma_subida_en: '2026-08-07T16:00:00.000Z' })).toBe(false);
    expect(firmaPorSubir({ ...base, firma_descartada: 1 })).toBe(false);
    expect(firmaPorSubir({ ...base, firma_local: null })).toBe(false);
  });
});
