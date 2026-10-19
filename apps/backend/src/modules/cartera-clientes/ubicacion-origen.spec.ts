import { origenAlGuardar, pideGeocodificarAlGuardar } from './ubicacion-origen';

const GOOGLE = {
  lat: 32.5251,
  lng: -117.0213,
  ubicacionOrigen: 'geocodificada' as const,
};

describe('origenAlGuardar (T-72, D3)', () => {
  it('un alta sin coordenada no tiene origen', () => {
    expect(origenAlGuardar({ lat: null, lng: null }, null)).toBeNull();
  });

  it('un alta con coordenada la capturo la oficina', () => {
    expect(origenAlGuardar({ lat: 32.5, lng: -117 }, null)).toBe('manual');
  });

  it('reenviar la misma coordenada conserva su origen: el formulario manda la ficha completa', () => {
    expect(origenAlGuardar({ lat: 32.5251, lng: -117.0213 }, GOOGLE)).toBe(
      'geocodificada',
    );
    expect(
      origenAlGuardar(
        { lat: 32.5149, lng: -117.0382 },
        { lat: 32.5149, lng: -117.0382, ubicacionOrigen: 'gps' },
      ),
    ).toBe('gps');
  });

  it('cambiar cualquiera de las dos la vuelve manual', () => {
    expect(origenAlGuardar({ lat: 32.53, lng: -117.0213 }, GOOGLE)).toBe(
      'manual',
    );
    expect(origenAlGuardar({ lat: 32.5251, lng: -117.03 }, GOOGLE)).toBe(
      'manual',
    );
  });

  it('borrar la coordenada borra su origen', () => {
    expect(origenAlGuardar({ lat: null, lng: null }, GOOGLE)).toBeNull();
  });

  it('una coordenada nueva en un cliente que no tenia es manual', () => {
    expect(
      origenAlGuardar(
        { lat: 32.5, lng: -117 },
        { lat: null, lng: null, ubicacionOrigen: null },
      ),
    ).toBe('manual');
  });
});

describe('pideGeocodificarAlGuardar (T-72, D5)', () => {
  const SIN = { domicilio: 'Av. Revolución 1234', lat: null };

  it('un alta con domicilio y sin coordenada si', () => {
    expect(pideGeocodificarAlGuardar(undefined, SIN)).toBe(true);
  });

  it('una edicion que cambio el domicilio, sin coordenada, si', () => {
    expect(pideGeocodificarAlGuardar('Calle vieja 1', SIN)).toBe(true);
    expect(pideGeocodificarAlGuardar(null, SIN)).toBe(true);
  });

  it('una edicion que no cambio el domicilio no (solo espacios no es un cambio)', () => {
    expect(pideGeocodificarAlGuardar('Av. Revolución 1234', SIN)).toBe(false);
    expect(pideGeocodificarAlGuardar('  Av. Revolución 1234 ', SIN)).toBe(
      false,
    );
  });

  it('con coordenada nunca', () => {
    expect(
      pideGeocodificarAlGuardar(undefined, { domicilio: 'Calle 1', lat: 32.5 }),
    ).toBe(false);
    expect(
      pideGeocodificarAlGuardar('Otra', { domicilio: 'Calle 1', lat: 32.5 }),
    ).toBe(false);
  });

  it('sin domicilio nunca', () => {
    expect(
      pideGeocodificarAlGuardar(undefined, { domicilio: null, lat: null }),
    ).toBe(false);
    expect(
      pideGeocodificarAlGuardar('Calle 1', { domicilio: '  ', lat: null }),
    ).toBe(false);
  });
});
