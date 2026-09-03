import { calcularExcepciones } from './calcular-excepciones';

describe('calcularExcepciones', () => {
  it('sin marcados y sin perfil, no hay excepciones', () => {
    expect(calcularExcepciones(new Set(), [])).toEqual([]);
  });

  it('lo que el perfil ya da y sigue marcado no genera excepcion', () => {
    const marcados = new Set(['cliente.gestionar']);
    expect(calcularExcepciones(marcados, ['cliente.gestionar'])).toEqual([]);
  });

  it('lo que el perfil NO da y sigue sin marcar no genera excepcion', () => {
    const marcados = new Set<string>();
    expect(calcularExcepciones(marcados, [])).toEqual([]);
  });

  it('marcado que el perfil NO da genera una excepcion habilitado=true', () => {
    const marcados = new Set(['vendedor.gestionar']);
    expect(calcularExcepciones(marcados, [])).toEqual([
      { clave: 'vendedor.gestionar', habilitado: true },
    ]);
  });

  it('desmarcado que el perfil SI da genera una excepcion habilitado=false', () => {
    const marcados = new Set<string>();
    expect(calcularExcepciones(marcados, ['cliente.gestionar'])).toEqual([
      { clave: 'cliente.gestionar', habilitado: false },
    ]);
  });

  it('combina varias excepciones de los dos sentidos a la vez', () => {
    const marcados = new Set(['cliente.gestionar', 'vendedor.gestionar']);
    const delPerfil = ['cliente.gestionar', 'producto.gestionar'];
    const resultado = calcularExcepciones(marcados, delPerfil);

    expect(resultado).toHaveLength(2);
    expect(resultado).toContainEqual({ clave: 'vendedor.gestionar', habilitado: true });
    expect(resultado).toContainEqual({ clave: 'producto.gestionar', habilitado: false });
  });

  it('es la inversa exacta de combinarPermisos: aplicar el resultado reproduce "marcados"', () => {
    const delPerfil = ['cliente.gestionar', 'producto.gestionar'];
    const marcados = new Set(['cliente.gestionar', 'vendedor.gestionar']);
    const excepciones = calcularExcepciones(marcados, delPerfil);

    const efectivos = new Set(delPerfil);
    for (const { clave, habilitado } of excepciones) {
      if (habilitado) efectivos.add(clave);
      else efectivos.delete(clave);
    }

    expect(efectivos).toEqual(marcados);
  });
});
