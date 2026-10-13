import { BadRequestException } from '@nestjs/common';
import {
  MOTIVO_COMENTARIO_LARGO,
  MOTIVO_MOTIVO_LARGO,
  MOTIVO_SIN_MOTIVO,
  normalizarComentario,
  normalizarMotivo,
} from './peticiones.service';

describe('normalizarMotivo', () => {
  it('recorta los espacios', () => {
    expect(normalizarMotivo('  Era de credito  ')).toBe('Era de credito');
  });

  it.each([[undefined], [''], ['   ']])('sin texto (%p) es 400', (crudo) => {
    expect(() => normalizarMotivo(crudo)).toThrow(
      new BadRequestException(MOTIVO_SIN_MOTIVO),
    );
  });

  it('500 caracteres entran; 501 no', () => {
    expect(normalizarMotivo('x'.repeat(500))).toHaveLength(500);
    expect(() => normalizarMotivo('x'.repeat(501))).toThrow(
      MOTIVO_MOTIVO_LARGO,
    );
  });
});

describe('normalizarComentario', () => {
  it('vacio o ausente es null; con texto, recortado', () => {
    expect(normalizarComentario(undefined)).toBeNull();
    expect(normalizarComentario('   ')).toBeNull();
    expect(normalizarComentario(' No procede ')).toBe('No procede');
  });

  it('mas de 500 caracteres es 400', () => {
    expect(() => normalizarComentario('x'.repeat(501))).toThrow(
      MOTIVO_COMENTARIO_LARGO,
    );
  });
});
