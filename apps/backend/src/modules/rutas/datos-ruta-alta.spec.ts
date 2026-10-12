import { normalizarDatosRutaAlta } from './datos-ruta-alta';

const CLIENTE = '0b7f5e2a-3c1d-4e8f-9a6b-1c2d3e4f5a6b';

describe('normalizarDatosRutaAlta (T-37)', () => {
  it('un cliente uuid entra, en minusculas', () => {
    expect(
      normalizarDatosRutaAlta({ cliente_id: CLIENTE.toUpperCase() }),
    ).toEqual({
      ok: true,
      alta: { clienteId: CLIENTE },
    });
  });

  it('ignora cualquier otro campo de datos', () => {
    expect(
      normalizarDatosRutaAlta({ cliente_id: CLIENTE, orden: 3, fecha: 'x' }),
    ).toEqual({ ok: true, alta: { clienteId: CLIENTE } });
  });

  it.each([
    ['sin cliente_id', {}],
    ['cliente_id null', { cliente_id: null }],
    ['cliente_id numero', { cliente_id: 7 }],
    ['cliente_id que no es uuid', { cliente_id: 'cli-1' }],
    ['uuid con espacios', { cliente_id: ` ${CLIENTE} ` }],
  ])('%s se rechaza nombrando el campo', (_caso, datos) => {
    const r = normalizarDatosRutaAlta(datos);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('debia rechazarse');
    expect(r.motivo).toContain('cliente_id');
  });
});
