import { ForbiddenException } from '@nestjs/common';
import {
  normalizarSucursalPedida,
  resolverAlcance,
  TODAS,
} from './alcance-sucursal';

describe('resolverAlcance', () => {
  describe('usuario General (sucursal_id null en la base)', () => {
    it('sin pedir nada ve todas', () => {
      expect(resolverAlcance(null, null)).toEqual({ tipo: 'todas' });
    });

    it('pidiendo "todas" ve todas', () => {
      expect(resolverAlcance(null, TODAS)).toEqual({ tipo: 'todas' });
    });

    it('pidiendo una sucursal concreta ve solo esa', () => {
      expect(resolverAlcance(null, 'TJ')).toEqual({
        tipo: 'una',
        codigo: 'TJ',
      });
    });
  });

  describe('usuario atado a una sucursal', () => {
    it('sin pedir nada ve la suya', () => {
      expect(resolverAlcance('TJ', null)).toEqual({
        tipo: 'una',
        codigo: 'TJ',
      });
    });

    it('pidiendo la suya ve la suya', () => {
      expect(resolverAlcance('TJ', 'TJ')).toEqual({
        tipo: 'una',
        codigo: 'TJ',
      });
    });

    // Pedir "todas" no nombra una sucursal ajena: es el selector que se quedo
    // en la URL al navegar, no un intento de escalar. Devolverle lo suyo es
    // correcto Y amable; un 403 aqui romperia la navegacion normal.
    it('pidiendo "todas" recibe la suya, no un 403', () => {
      expect(resolverAlcance('TJ', TODAS)).toEqual({
        tipo: 'una',
        codigo: 'TJ',
      });
    });

    it('pidiendo otra sucursal recibe 403', () => {
      expect(() => resolverAlcance('TJ', 'MX')).toThrow(ForbiddenException);
    });
  });
});

describe('normalizarSucursalPedida', () => {
  it('trata el param ausente como null', () => {
    expect(normalizarSucursalPedida(undefined)).toBeNull();
  });

  // ?sucursal= (vacio) es lo que produce un formulario o un link mal armado.
  // Tratarlo como "" en vez de como ausente haria que resolverAlcance buscara
  // una sucursal con codigo vacio y devolviera una lista vacia sin explicar
  // por que.
  it('trata el param vacio como null', () => {
    expect(normalizarSucursalPedida('   ')).toBeNull();
  });

  it('sube el codigo a mayusculas', () => {
    expect(normalizarSucursalPedida('tj')).toBe('TJ');
  });

  it('reconoce "todas" sin importar como venga escrito', () => {
    expect(normalizarSucursalPedida('TODAS')).toBe(TODAS);
    expect(normalizarSucursalPedida('todas')).toBe(TODAS);
  });
});
