import { combinarPermisos, esMaestro, PERFIL_MAESTRO } from './permisos';

describe('esMaestro', () => {
  it('reconoce al perfil maestro', () => {
    expect(esMaestro(PERFIL_MAESTRO)).toBe(true);
  });

  // 'Administrador' y 'Administrador General' son perfiles DISTINTOS de la
  // semilla de T-05. Comparar por prefijo le daria acceso total al primero.
  it('no confunde a "Administrador" con "Administrador General"', () => {
    expect(esMaestro('Administrador')).toBe(false);
  });
});

describe('combinarPermisos', () => {
  it('sin excepciones devuelve lo del perfil', () => {
    expect(
      combinarPermisos(['venta.registrar', 'cliente.gestionar'], []),
    ).toEqual(new Set(['venta.registrar', 'cliente.gestionar']));
  });

  it('una excepcion habilitada concede lo que el perfil no da', () => {
    const efectivos = combinarPermisos(
      ['venta.registrar'],
      [{ clave: 'sucursal.gestionar', habilitado: true }],
    );
    expect(efectivos).toEqual(
      new Set(['venta.registrar', 'sucursal.gestionar']),
    );
  });

  it('una excepcion deshabilitada quita lo que el perfil si da', () => {
    const efectivos = combinarPermisos(
      ['venta.registrar', 'venta.editar_eliminar'],
      [{ clave: 'venta.editar_eliminar', habilitado: false }],
    );
    expect(efectivos).toEqual(new Set(['venta.registrar']));
  });

  // El caso que decide la precedencia (D3): la excepcion gana, no el perfil.
  it('la excepcion gana sobre el perfil en los dos sentidos', () => {
    const efectivos = combinarPermisos(
      ['venta.registrar'],
      [
        { clave: 'venta.registrar', habilitado: false },
        { clave: 'cobranza.registrar', habilitado: true },
      ],
    );
    expect(efectivos).toEqual(new Set(['cobranza.registrar']));
  });

  it('negar algo que el perfil tampoco daba no truena', () => {
    expect(
      combinarPermisos([], [{ clave: 'venta.registrar', habilitado: false }]),
    ).toEqual(new Set());
  });

  // Los 6 perfiles sembrados en T-05 estan VACIOS hasta T-08b: este es el caso
  // normal hoy, no un caso raro.
  it('un perfil sin permisos y sin excepciones no da nada', () => {
    expect(combinarPermisos([], [])).toEqual(new Set());
  });
});
