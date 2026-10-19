import {
  ETIQUETA_DOMICILIO,
  avisoUbicacionAlta,
  ayudaDomicilio,
  ubicacionAltaDe,
  ubicacionRecibida,
  validarAltaProspecto,
  type EntradaAltaProspecto,
  type UbicacionAlta,
} from './alta-prospecto';

const GPS = { estado: 'ok' as const, lat: 32.5149, lng: -117.0382 };
const SIN_GPS = 'Sin GPS: escribe la dirección del negocio.';

const entrada = (cambios: Partial<EntradaAltaProspecto> = {}): EntradaAltaProspecto => ({
  nombre: 'Tacos Aaron',
  telefono: '6641112233',
  encargado: 'Don Aaron',
  ubicacion: GPS,
  domicilio: '',
  ...cambios,
});

describe('validarAltaProspecto (T-72, D1)', () => {
  it('con GPS la direccion es opcional', () => {
    expect(validarAltaProspecto(entrada())).toEqual({
      faltantes: [],
      domicilioObligatorio: false,
      ubicacion: { lat: 32.5149, lng: -117.0382, domicilio: null },
    });
  });

  it('con GPS y direccion se guardan las dos, la direccion recortada', () => {
    expect(validarAltaProspecto(entrada({ domicilio: '  Av. Revolución 1234  ' })).ubicacion).toEqual({
      lat: 32.5149,
      lng: -117.0382,
      domicilio: 'Av. Revolución 1234',
    });
  });

  it.each<[string, UbicacionAlta]>([
    ['no se tomo', { estado: 'sin-tomar' }],
    ['permiso negado', { estado: 'fallo', permisoNegado: true }],
    ['sin senal o tiempo agotado', { estado: 'fallo', permisoNegado: false }],
  ])('sin GPS (%s) la direccion es obligatoria', (_caso, ubicacion) => {
    const sin = validarAltaProspecto(entrada({ ubicacion }));
    expect(sin.domicilioObligatorio).toBe(true);
    expect(sin.faltantes).toEqual([SIN_GPS]);
    expect(sin.ubicacion).toBeNull();

    expect(validarAltaProspecto(entrada({ ubicacion, domicilio: ' Av. Revolución 1234 ' })).ubicacion).toEqual({
      lat: null,
      lng: null,
      domicilio: 'Av. Revolución 1234',
    });
  });

  it.each([
    [Number.NaN, -117],
    [32.5, Number.POSITIVE_INFINITY],
    [91, -117],
    [32.5, -181],
  ])('una lectura invalida (%p, %p) cuenta como sin GPS y no se guarda', (lat, lng) => {
    const ubicacion: UbicacionAlta = { estado: 'ok', lat, lng };
    expect(validarAltaProspecto(entrada({ ubicacion })).faltantes).toEqual([SIN_GPS]);
    expect(validarAltaProspecto(entrada({ ubicacion })).domicilioObligatorio).toBe(true);
    expect(validarAltaProspecto(entrada({ ubicacion, domicilio: 'Calle 5' })).ubicacion).toEqual({
      lat: null,
      lng: null,
      domicilio: 'Calle 5',
    });
  });

  it('solo espacios no cuenta como direccion', () => {
    expect(validarAltaProspecto(entrada({ ubicacion: { estado: 'sin-tomar' }, domicilio: '   ' })).faltantes).toEqual([
      SIN_GPS,
    ]);
  });

  it('mientras busca la ubicacion espera, salvo que ya haya direccion', () => {
    expect(validarAltaProspecto(entrada({ ubicacion: { estado: 'buscando' } })).faltantes).toEqual([
      'Esperando la ubicación…',
    ]);
    expect(
      validarAltaProspecto(entrada({ ubicacion: { estado: 'buscando' }, domicilio: 'Calle 5' })).ubicacion,
    ).toEqual({ lat: null, lng: null, domicilio: 'Calle 5' });
  });

  it('la direccion tiene el tope del servidor: 300', () => {
    expect(validarAltaProspecto(entrada({ domicilio: 'x'.repeat(300) })).faltantes).toEqual([]);
    expect(validarAltaProspecto(entrada({ domicilio: 'x'.repeat(301) })).faltantes).toEqual([
      'La dirección no puede pasar de 300 caracteres.',
    ]);
  });

  it('nombre, telefono y encargado siguen siendo obligatorios, en el orden de la pantalla', () => {
    const r = validarAltaProspecto(
      entrada({ nombre: ' ', telefono: '', encargado: '  ', ubicacion: { estado: 'sin-tomar' } }),
    );
    expect(r.faltantes).toEqual([
      'Captura el nombre del negocio.',
      'Captura el teléfono del negocio.',
      'Captura el nombre del encargado.',
      SIN_GPS,
    ]);
    expect(r.ubicacion).toBeNull();
  });
});

describe('etiqueta y ayuda de la direccion', () => {
  it('la etiqueta es exacta y la obligatoriedad va en la ayuda', () => {
    expect(ETIQUETA_DOMICILIO).toBe('Dirección del negocio');
    expect(ayudaDomicilio(true)).toBe('Obligatoria sin GPS.');
    expect(ayudaDomicilio(false)).toBe('Opcional.');
  });
});

describe('ubicacionAltaDe', () => {
  it('una lectura buena pasa sin la precision', () => {
    expect(ubicacionAltaDe({ estado: 'ok', lat: 32.5, lng: -117, precisionM: 12 })).toEqual({
      estado: 'ok',
      lat: 32.5,
      lng: -117,
    });
  });

  it('permiso negado y sin senal son fallos distintos', () => {
    expect(ubicacionAltaDe({ estado: 'permiso-negado' })).toEqual({ estado: 'fallo', permisoNegado: true });
    expect(ubicacionAltaDe({ estado: 'sin-senal', detalle: 'tiempo' })).toEqual({
      estado: 'fallo',
      permisoNegado: false,
    });
  });
});

describe('ubicacionRecibida (lectura tardia del GPS)', () => {
  const lectura = { estado: 'ok' as const, lat: 32.5, lng: -117, precisionM: 12 };

  it('con el mismo formulario se pinta la lectura', () => {
    expect(ubicacionRecibida(3, 3, lectura)).toEqual({ estado: 'ok', lat: 32.5, lng: -117 });
    expect(ubicacionRecibida(3, 3, { estado: 'permiso-negado' })).toEqual({
      estado: 'fallo',
      permisoNegado: true,
    });
  });

  it('si se guardo mientras buscaba, la lectura es del negocio anterior y se descarta', () => {
    expect(ubicacionRecibida(3, 4, lectura)).toBeNull();
    expect(ubicacionRecibida(3, 4, { estado: 'sin-senal', detalle: 'tiempo' })).toBeNull();
  });
});

describe('avisoUbicacionAlta', () => {
  it('dice que hacer en cada fallo, y nada si no hay fallo', () => {
    expect(avisoUbicacionAlta({ estado: 'fallo', permisoNegado: true })).toBe(
      'Sin permiso de ubicación. Escribe la dirección del negocio para guardarlo; la oficina lo ubicará con ella.',
    );
    expect(avisoUbicacionAlta({ estado: 'fallo', permisoNegado: false })).toBe(
      'No se pudo leer la ubicación (sin señal de GPS). Escribe la dirección del negocio o inténtalo afuera del local.',
    );
    expect(avisoUbicacionAlta({ estado: 'ok', lat: Number.NaN, lng: -117 })).toBe(
      'El GPS dio una ubicación que no sirve. Escribe la dirección del negocio o vuelve a intentarlo.',
    );
    expect(avisoUbicacionAlta(GPS)).toBeNull();
    expect(avisoUbicacionAlta({ estado: 'sin-tomar' })).toBeNull();
    expect(avisoUbicacionAlta({ estado: 'buscando' })).toBeNull();
  });
});
