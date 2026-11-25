import { formatearFechaCorta, formatearFechaHora, formatearHora, formatearMomento } from './momento';

/**
 * Las fechas se construyen con componentes LOCALES (`new Date(2026, 9, 10, 11, 2)`)
 * y se pasan como ISO, que es lo que guarda `sincronizado_en`. Asi la prueba da
 * lo mismo con la zona de Tijuana que en UTC o en el CI: lo que se comprueba es
 * que la salida vuelve a la hora local, no una hora concreta.
 */
describe('formatearMomento', () => {
  it('escribe la hora LOCAL del dispositivo, no la UTC del ISO', () => {
    expect(formatearMomento(new Date(2026, 9, 10, 11, 2).toISOString())).toBe(
      '2026-10-10 11:02',
    );
  });

  it('rellena con cero el mes, el dia, la hora y el minuto', () => {
    expect(formatearMomento(new Date(2026, 0, 5, 7, 4).toISOString())).toBe('2026-01-05 07:04');
  });

  it('la medianoche es 00:00 del dia que empieza', () => {
    expect(formatearMomento(new Date(2026, 11, 31, 0, 0).toISOString())).toBe(
      '2026-12-31 00:00',
    );
  });

  it('sin catalogos todavia (null) dice "nunca"', () => {
    expect(formatearMomento(null)).toBe('nunca');
  });

  it('una cadena que no es fecha dice "nunca" y no "NaN-NaN-NaN"', () => {
    expect(formatearMomento('basura')).toBe('nunca');
  });
});

describe('formatearHora (T-39)', () => {
  it('es la hora LOCAL HH:mm', () => {
    expect(formatearHora(new Date(2026, 9, 17, 9, 5).toISOString())).toBe('09:05');
  });

  it('sin hora o con basura dice --:--', () => {
    expect(formatearHora(null)).toBe('--:--');
    expect(formatearHora('no es fecha')).toBe('--:--');
  });
});

describe('formatearFechaCorta', () => {
  it.each([
    ['2026-11-03', '3 nov 2026'],
    ['2026-01-31', '31 ene 2026'],
    ['2025-12-10', '10 dic 2025'],
  ])('%s -> %s', (fecha, esperado) => {
    expect(formatearFechaCorta(fecha)).toBe(esperado);
  });

  it.each(['', 'ayer', '2026-13-01', '2026-11-00', '2026-11-03T10:00:00Z'])('deja tal cual lo que no es AAAA-MM-DD: %p', (fecha) => {
    expect(formatearFechaCorta(fecha)).toBe(fecha);
  });
});

describe('formatearFechaHora (pieza 7, la nota impresa)', () => {
  it('es la fecha corta y la hora LOCAL separadas por punto medio', () => {
    expect(formatearFechaHora(new Date(2026, 10, 18, 11, 58).toISOString())).toBe('18 nov 2026 · 11:58');
  });

  it('rellena la hora y el minuto, no el dia', () => {
    expect(formatearFechaHora(new Date(2026, 0, 5, 7, 4).toISOString())).toBe('5 ene 2026 · 07:04');
  });

  it('una cadena que no es fecha sale tal cual', () => {
    expect(formatearFechaHora('basura')).toBe('basura');
  });

  it('una fecha sin hora (nota de la oficina) sale solo con el dia, sin correrse a ayer', () => {
    expect(formatearFechaHora('2026-10-25')).toBe('25 oct 2026');
  });
});
