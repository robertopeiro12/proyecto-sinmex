import { NOMBRES_ICONO, TRAZOS } from './iconos';

test('cada icono tiene al menos un trazo y ninguno vacío', () => {
  for (const nombre of NOMBRES_ICONO) {
    expect(TRAZOS[nombre]?.length).toBeGreaterThan(0);
    for (const d of TRAZOS[nombre]) expect(d.trim()).toMatch(/^[Mm]/);
  }
});

test('no hay trazos sin nombre', () => {
  expect(Object.keys(TRAZOS).sort()).toEqual([...NOMBRES_ICONO].sort());
});
