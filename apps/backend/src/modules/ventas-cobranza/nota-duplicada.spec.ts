import { esNotaDuplicada, motivoNotaDuplicada } from './nota-duplicada';

describe('# de nota duplicado (T-17, #95)', () => {
  it.each<[string, unknown, boolean]>([
    [
      'el unique del # de nota',
      { code: '23505', constraint: 'uq_venta_nota_num_nota_sucursal' },
      true,
    ],
    [
      'el unique del folio (otra cosa)',
      { code: '23505', constraint: 'venta_nota_folio_key' },
      false,
    ],
    [
      'un check violado',
      { code: '23514', constraint: 'uq_venta_nota_num_nota_sucursal' },
      false,
    ],
    ['algo que no es un error de Postgres', new Error('otra cosa'), false],
  ])('%s', (_caso, error, esperado) => {
    expect(esNotaDuplicada(error)).toBe(esperado);
  });

  it('el motivo dice que nota y donde', () => {
    expect(motivoNotaDuplicada('1234')).toBe(
      'Ya existe la nota 1234 en esta sucursal.',
    );
  });
});
