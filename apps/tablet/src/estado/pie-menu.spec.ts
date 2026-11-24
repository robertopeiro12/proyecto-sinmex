import { textoHaceCuanto, textoSinSincronizar } from './pie-menu';

describe('pie del menú', () => {
  test('hace cuánto', () => {
    const ahora = '2026-11-24T18:30:00.000Z';
    expect(textoHaceCuanto(null, ahora)).toBe('nunca');
    expect(textoHaceCuanto('2026-11-24T18:29:40.000Z', ahora)).toBe('hace un momento');
    expect(textoHaceCuanto('2026-11-24T18:18:00.000Z', ahora)).toBe('hace 12 min');
    expect(textoHaceCuanto('2026-11-24T16:00:00.000Z', ahora)).toBe('hace 2 h');
  });

  test('sin sincronizar', () => {
    expect(textoSinSincronizar(0)).toBe('Todo sincronizado');
    expect(textoSinSincronizar(3)).toBe('3 sin sincronizar');
  });
});
