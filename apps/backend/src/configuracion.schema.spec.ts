import { configuracionSchema } from './configuracion.schema';

describe('configuracionSchema (T-72)', () => {
  it('GOOGLE_MAPS_API_KEY es opcional y admite la linea en blanco del .env.example', () => {
    const clave = configuracionSchema.extract('GOOGLE_MAPS_API_KEY');
    expect(clave.validate(undefined).error).toBeUndefined();
    expect(clave.validate('').error).toBeUndefined();
    expect(clave.validate('AIza123').error).toBeUndefined();
  });

  it('GEOCODIFICADOR_FALSO solo acepta 0 o 1, y por defecto es 0', () => {
    const falso = configuracionSchema.extract('GEOCODIFICADOR_FALSO');
    expect(falso.validate(undefined).value).toBe('0');
    expect(falso.validate('1').error).toBeUndefined();
    expect(falso.validate('si').error).toBeDefined();
  });
});
