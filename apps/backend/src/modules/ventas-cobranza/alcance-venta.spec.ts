import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { exigirAlcanceSobre } from './alcance-venta';

describe('exigirAlcanceSobre: alcance contra la sucursal YA LEIDA', () => {
  it('un usuario General alcanza cualquier sucursal', () => {
    expect(() => exigirAlcanceSobre({ codigo: null }, 'MX')).not.toThrow();
  });

  it('un usuario de Tijuana alcanza Tijuana', () => {
    expect(() => exigirAlcanceSobre({ codigo: 'TJ' }, 'TJ')).not.toThrow();
  });

  it('un usuario de Tijuana no alcanza Mexicali: 403', () => {
    expect(() => exigirAlcanceSobre({ codigo: 'TJ' }, 'MX')).toThrow(
      ForbiddenException,
    );
  });

  it('un usuario borrado o inexistente: 401', () => {
    expect(() => exigirAlcanceSobre(undefined, 'TJ')).toThrow(
      UnauthorizedException,
    );
  });
});
