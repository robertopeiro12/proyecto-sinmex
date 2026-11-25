import { relojSistema } from '@/datos/reloj';

import { ticketDePrueba } from './prueba';
import { armarTicket, estadoTicket } from './ticket';

test('la nota de prueba cabe en 32 y en 48 columnas', () => {
  const d = ticketDePrueba(
    { ahora: () => new Date(2026, 10, 25, 10, 20).toISOString(), hoy: () => '2026-11-25' },
    'Juan Pérez',
  );
  expect(estadoTicket(d)).toBe('ABONADO');
  for (const columnas of [32, 48] as const) {
    const renglones = armarTicket(d, columnas);
    expect(renglones.length).toBeGreaterThan(10);
    expect(renglones.every((r) => r.length <= columnas)).toBe(true);
  }
});

describe('el abono de prueba lleva el día de Tijuana', () => {
  // Jest copia process.env por prueba: cambiar TZ aqui no mueve el reloj de
  // Node, asi que la zona entra por el `Reloj` (como en el resto de la app).
  test('a las 17:30 de Tijuana (01:30 UTC del día siguiente) el abono es de hoy', () => {
    const tijuana1730 = { ahora: () => '2026-11-26T01:30:00.000Z', hoy: () => '2026-11-25' };
    const d = ticketDePrueba(tijuana1730);
    expect(d.momento).toBe('2026-11-26T01:30:00.000Z');
    expect(d.abonos).toEqual([{ fecha: '2026-11-25', montoCentavos: 30000 }]);
  });

  describe('con el reloj del sistema', () => {
    afterEach(() => jest.useRealTimers());

    test('a las 17:30 locales el abono es del día local', () => {
      jest.useFakeTimers({ now: new Date(2026, 10, 25, 17, 30) });
      expect(ticketDePrueba(relojSistema).abonos[0]?.fecha).toBe('2026-11-25');
    });
  });
});
