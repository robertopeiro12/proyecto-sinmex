import { planearReemplazo, type FilaViva } from './reemplazo-ruta';

const fila = (
  id: string,
  clienteId: string,
  orden: number,
  origen: 'oficina' | 'vendedor' = 'oficina',
): FilaViva => ({ id, clienteId, orden, origen });

describe('planearReemplazo (T-37, D14)', () => {
  it('sin filas vivas inserta toda la lista en orden', () => {
    expect(planearReemplazo([], ['a', 'b'])).toEqual({
      actualizar: [],
      insertar: [
        { clienteId: 'a', orden: 1 },
        { clienteId: 'b', orden: 2 },
      ],
      borrar: [],
    });
  });

  it('una fila de la oficina que no viene se borra', () => {
    expect(
      planearReemplazo([fila('r1', 'a', 1), fila('r2', 'b', 2)], ['b']),
    ).toEqual({
      actualizar: [{ id: 'r2', orden: 1, origen: 'oficina' }],
      insertar: [],
      borrar: ['r1'],
    });
  });

  it('la fila del vendedor que viene en la lista se adopta: orden de la oficina y origen oficina', () => {
    expect(
      planearReemplazo([fila('r1', 'a', 1, 'vendedor')], ['b', 'a']),
    ).toEqual({
      actualizar: [{ id: 'r1', orden: 2, origen: 'oficina' }],
      insertar: [{ clienteId: 'b', orden: 1 }],
      borrar: [],
    });
  });

  it('las del vendedor que no vienen se conservan al final, en su orden relativo', () => {
    const vivas = [
      fila('r1', 'a', 1),
      fila('r2', 'b', 2, 'vendedor'),
      fila('r3', 'd', 5, 'vendedor'),
    ];
    expect(planearReemplazo(vivas, ['c', 'a'])).toEqual({
      actualizar: [
        { id: 'r1', orden: 2, origen: 'oficina' },
        { id: 'r2', orden: 3, origen: 'vendedor' },
        { id: 'r3', orden: 4, origen: 'vendedor' },
      ],
      insertar: [{ clienteId: 'c', orden: 1 }],
      borrar: [],
    });
  });

  it('una fila que ya tiene el orden y el origen que le tocan no se toca', () => {
    expect(
      planearReemplazo(
        [fila('r1', 'a', 1), fila('r2', 'b', 2, 'vendedor')],
        ['a'],
      ),
    ).toEqual({ actualizar: [], insertar: [], borrar: [] });
  });

  it('una lista vacia quita las de la oficina y deja las del vendedor arriba', () => {
    expect(
      planearReemplazo(
        [fila('r1', 'a', 1), fila('r2', 'b', 2, 'vendedor')],
        [],
      ),
    ).toEqual({
      actualizar: [{ id: 'r2', orden: 1, origen: 'vendedor' }],
      insertar: [],
      borrar: ['r1'],
    });
  });
});
