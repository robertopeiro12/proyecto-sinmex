import { ticketDePrueba } from './prueba';
import { armarTicket, estadoTicket } from './ticket';

test('la nota de prueba cabe en 32 y en 48 columnas', () => {
  const d = ticketDePrueba(new Date(2026, 10, 25, 10, 20).toISOString(), 'Juan Pérez');
  expect(estadoTicket(d)).toBe('ABONADO');
  for (const columnas of [32, 48] as const) {
    const renglones = armarTicket(d, columnas);
    expect(renglones.length).toBeGreaterThan(10);
    expect(renglones.every((r) => r.length <= columnas)).toBe(true);
  }
});
