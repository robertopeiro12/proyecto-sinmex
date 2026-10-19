import { formatearHora, formatearMomento } from './momento';

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
