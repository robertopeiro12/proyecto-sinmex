import {
  pastillaVisita,
  textoEstadoVisitas,
  textoUbicacionVisita,
  validarVisita,
  type EntradaVisita,
} from './visita';

const CERRADO = { id: 'mot-cerrado', exige_foto: 1 as const, exige_atendio: 0 as const };
const ENCARGADO = { id: 'mot-encargado', exige_foto: 1 as const, exige_atendio: 1 as const };
const TENIA = { id: 'mot-tenia', exige_foto: 0 as const, exige_atendio: 0 as const };
const GPS = { estado: 'ok' as const, lat: 32.5149, lng: -117.0382, precisionM: 18.4 };

const entrada = (cambios: Partial<EntradaVisita> = {}): EntradaVisita => ({
  motivo: TENIA,
  observaciones: '',
  atendio: '',
  fotoUri: null,
  ubicacion: GPS,
  direccionTexto: '',
  ...cambios,
});

describe('validarVisita (T-39, D7)', () => {
  it('motivo sin exigencias y GPS: se puede guardar, con los textos vacios en null', () => {
    const r = validarVisita(entrada({ observaciones: '  ' }));
    expect(r.faltantes).toEqual([]);
    expect(r.visita).toEqual({
      motivoVisitaId: 'mot-tenia',
      observaciones: null,
      atendio: null,
      lat: 32.5149,
      lng: -117.0382,
      precisionM: 18.4,
      direccionTexto: null,
      fotoUri: null,
    });
  });

  it('sin motivo no se guarda', () => {
    const r = validarVisita(entrada({ motivo: null }));
    expect(r.visita).toBeNull();
    expect(r.faltantes).toContain('Elige el motivo de la visita.');
  });

  it('un motivo que exige foto no guarda sin foto, y si con ella', () => {
    expect(validarVisita(entrada({ motivo: CERRADO })).faltantes).toEqual([
      'Este motivo exige una foto: tómala antes de guardar.',
    ]);
    expect(validarVisita(entrada({ motivo: CERRADO })).fotoObligatoria).toBe(true);
    expect(validarVisita(entrada({ motivo: CERRADO, fotoUri: 'file:///f.jpg' })).visita?.fotoUri).toBe('file:///f.jpg');
  });

  it('un motivo que exige nombre no acepta solo espacios', () => {
    const r = validarVisita(entrada({ motivo: ENCARGADO, fotoUri: 'file:///f.jpg', atendio: '   ' }));
    expect(r.atendioObligatorio).toBe(true);
    expect(r.faltantes).toEqual(['Escribe el nombre de quien atendió.']);
    expect(validarVisita(entrada({ motivo: ENCARGADO, fotoUri: 'file:///f.jpg', atendio: ' Lupe ' })).visita?.atendio).toBe('Lupe');
  });

  it('sin exigencia, el nombre de quien atendio es opcional pero se guarda si se escribe', () => {
    const r = validarVisita(entrada({ atendio: 'Don Beto' }));
    expect(r.atendioObligatorio).toBe(false);
    expect(r.visita?.atendio).toBe('Don Beto');
  });

  it('mientras busca la ubicacion no se guarda y el campo de direccion no se pide', () => {
    const r = validarVisita(entrada({ ubicacion: { estado: 'buscando' } }));
    expect(r.pedirDireccion).toBe(false);
    expect(r.faltantes).toEqual(['Esperando la ubicación…']);
  });

  it('sin GPS aparece la direccion y es obligatoria; escrita, se guarda', () => {
    const fallo = { estado: 'fallo' as const, permisoNegado: true };
    const sinDireccion = validarVisita(entrada({ ubicacion: fallo }));
    expect(sinDireccion.pedirDireccion).toBe(true);
    expect(sinDireccion.faltantes).toEqual(['Sin GPS: escribe la dirección o una referencia del lugar.']);

    const conDireccion = validarVisita(entrada({ ubicacion: fallo, direccionTexto: ' Frente al parque ' }));
    expect(conDireccion.visita).toMatchObject({ lat: null, lng: null, precisionM: null, direccionTexto: 'Frente al parque' });
  });

  it('direccion escrita y despues llega el GPS: se guardan las dos y el campo sigue a la vista (Review Focus 2)', () => {
    const r = validarVisita(entrada({ ubicacion: GPS, direccionTexto: 'Frente al parque' }));
    expect(r.pedirDireccion).toBe(true);
    expect(r.visita).toMatchObject({ lat: 32.5149, lng: -117.0382, direccionTexto: 'Frente al parque' });
  });

  it('los topes de texto son los del servidor', () => {
    expect(validarVisita(entrada({ observaciones: 'x'.repeat(501) })).faltantes).toEqual([
      'Las observaciones no pueden pasar de 500 caracteres.',
    ]);
    expect(validarVisita(entrada({ atendio: 'x'.repeat(121) })).faltantes).toEqual([
      'El nombre de quien atendió no puede pasar de 120 caracteres.',
    ]);
    expect(validarVisita(entrada({ direccionTexto: 'x'.repeat(301) })).faltantes).toEqual([
      'La dirección no puede pasar de 300 caracteres.',
    ]);
  });
});

describe('validarVisita: coordenadas', () => {
  it.each([
    [{ ...GPS, lat: 91 }],
    [{ ...GPS, lat: -90.5 }],
    [{ ...GPS, lng: 180.1 }],
    [{ ...GPS, lng: -181 }],
    [{ ...GPS, lat: Number.NaN }],
    [{ ...GPS, lng: Number.POSITIVE_INFINITY }],
    [{ ...GPS, precisionM: Number.NaN }],
  ])('%o no se guarda', (ubicacion) => {
    const r = validarVisita(entrada({ ubicacion }));
    expect(r.visita).toBeNull();
    expect(r.faltantes).toEqual(['La ubicación tomada no es válida: vuelve a intentar.']);
  });

  it('los limites exactos si valen', () => {
    expect(validarVisita(entrada({ ubicacion: { ...GPS, lat: -90, lng: 180 } })).visita).not.toBeNull();
  });

  it('con coordenada invalida y direccion escrita tampoco se guarda (no se mezcla basura con texto)', () => {
    const r = validarVisita(entrada({ ubicacion: { ...GPS, lat: 99 }, direccionTexto: 'Frente al parque' }));
    expect(r.visita).toBeNull();
  });

  it('los largos se miden en unidades UTF-16 (String.length), como el servidor', () => {
    // Un emoji ocupa 2 unidades: 251 emojis = 502 > 500, aunque sean 251 "caracteres".
    expect(validarVisita(entrada({ observaciones: '😀'.repeat(251) })).faltantes).toEqual([
      'Las observaciones no pueden pasar de 500 caracteres.',
    ]);
    expect(validarVisita(entrada({ observaciones: '😀'.repeat(250) })).faltantes).toEqual([]);
  });
});

describe('textoUbicacionVisita', () => {
  it.each([
    [{ estado: 'buscando' as const }, 'Buscando ubicación…'],
    [GPS, 'Ubicación tomada (±18 m)'],
    [{ ...GPS, precisionM: null }, 'Ubicación tomada'],
    [{ estado: 'fallo' as const, permisoNegado: false }, 'No se pudo obtener la ubicación'],
  ])('%o → %s', (u, texto) => {
    expect(textoUbicacionVisita(u)).toBe(texto);
  });
});

describe('pastillaVisita y textoEstadoVisitas', () => {
  it('cada estado de subida con su palabra; la rechazada trae el motivo sin el codigo', () => {
    expect(pastillaVisita({ sync_estado: 'pendiente', sync_error: null })).toEqual({
      texto: 'por subir', estado: 'pendiente', detalle: null,
    });
    expect(pastillaVisita({ sync_estado: 'sincronizado', sync_error: null })).toEqual({
      texto: 'subida', estado: 'listo', detalle: null,
    });
    expect(
      pastillaVisita({ sync_estado: 'error', sync_error: 'motivo-visita-inexistente: El motivo no existe.' }),
    ).toEqual({ texto: 'rechazada', estado: 'error', detalle: 'El motivo no existe.' });
  });

  it('el estado agregado de las visitas de un cliente', () => {
    expect(textoEstadoVisitas('error')).toBe('rechazada');
    expect(textoEstadoVisitas('pendiente')).toBe('por subir');
    expect(textoEstadoVisitas('listo')).toBe('subida');
  });
});
