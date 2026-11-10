import {
  planearReemplazo,
  type FilaViva,
  type PedidoCliente,
} from './reemplazo-ruta';

const fila = (
  id: string,
  clienteId: string,
  orden: number,
  origen: FilaViva['origen'] = 'oficina',
  recado: string | null = null,
): FilaViva => ({ id, clienteId, orden, origen, recado });

const pide = (...ids: string[]): PedidoCliente[] =>
  ids.map((clienteId) => ({ clienteId, recado: null }));

const sinSemanal = {
  clientesDeLaSemanal: new Set<string>(),
  rutaCambio: false,
};

describe('planearReemplazo', () => {
  it('sin filas vivas inserta toda la lista en orden', () => {
    expect(planearReemplazo([], pide('a', 'b'), sinSemanal)).toEqual({
      actualizar: [],
      insertar: [
        { clienteId: 'a', orden: 1, origen: 'oficina', recado: null },
        { clienteId: 'b', orden: 2, origen: 'oficina', recado: null },
      ],
      borrar: [],
    });
  });

  it('una fila de la oficina que no viene se borra', () => {
    expect(
      planearReemplazo(
        [fila('r1', 'a', 1), fila('r2', 'b', 2)],
        pide('b'),
        sinSemanal,
      ),
    ).toEqual({
      actualizar: [{ id: 'r2', orden: 1, recado: null }],
      insertar: [],
      borrar: [{ id: 'r1', clienteId: 'a', quitadoPor: 'oficina' }],
    });
  });

  it('conserva el origen al reordenar', () => {
    const plan = planearReemplazo(
      [fila('r1', 'A', 1, 'vendedor'), fila('r2', 'B', 2, 'semanal')],
      pide('B', 'A'),
      sinSemanal,
    );
    expect(plan.actualizar).toEqual([
      { id: 'r2', orden: 1, recado: null },
      { id: 'r1', orden: 2, recado: null },
    ]);
    expect(plan.insertar).toEqual([]);
    expect(plan.borrar).toEqual([]);
  });

  it('una nueva de la semanal nace semanal', () => {
    expect(
      planearReemplazo([], pide('C', 'D'), {
        clientesDeLaSemanal: new Set(['C']),
        rutaCambio: false,
      }).insertar,
    ).toEqual([
      { clienteId: 'C', orden: 1, origen: 'semanal', recado: null },
      { clienteId: 'D', orden: 2, origen: 'oficina', recado: null },
    ]);
  });

  it('las del vendedor que no vienen se conservan al final, en su orden relativo', () => {
    const vivas = [
      fila('r1', 'a', 1),
      fila('r2', 'b', 2, 'vendedor'),
      fila('r3', 'd', 5, 'vendedor'),
    ];
    expect(planearReemplazo(vivas, pide('c', 'a'), sinSemanal)).toEqual({
      actualizar: [
        { id: 'r1', orden: 2, recado: null },
        { id: 'r2', orden: 3, recado: null },
        { id: 'r3', orden: 4, recado: null },
      ],
      insertar: [{ clienteId: 'c', orden: 1, origen: 'oficina', recado: null }],
      borrar: [],
    });
  });

  it('una fila que ya tiene su orden y su recado no se toca', () => {
    expect(
      planearReemplazo(
        [fila('r1', 'a', 1), fila('r2', 'b', 2, 'vendedor')],
        pide('a'),
        sinSemanal,
      ),
    ).toEqual({ actualizar: [], insertar: [], borrar: [] });
  });

  it('una lista vacia quita las de la oficina y deja las del vendedor arriba', () => {
    expect(
      planearReemplazo(
        [fila('r1', 'a', 1), fila('r2', 'b', 2, 'vendedor')],
        [],
        sinSemanal,
      ),
    ).toEqual({
      actualizar: [{ id: 'r2', orden: 1, recado: null }],
      insertar: [],
      borrar: [{ id: 'r1', clienteId: 'a', quitadoPor: 'oficina' }],
    });
  });

  it('quitar a mano marca oficina', () => {
    expect(
      planearReemplazo([fila('r1', 'A', 1, 'semanal')], [], sinSemanal).borrar,
    ).toEqual([{ id: 'r1', clienteId: 'A', quitadoPor: 'oficina' }]);
  });

  it('cambiar de ruta marca cambio_ruta solo lo que vino de la semanal', () => {
    expect(
      planearReemplazo(
        [fila('r1', 'A', 1, 'semanal'), fila('r2', 'B', 2, 'oficina')],
        [],
        { clientesDeLaSemanal: new Set(), rutaCambio: true },
      ).borrar,
    ).toEqual([
      { id: 'r1', clienteId: 'A', quitadoPor: 'cambio_ruta' },
      { id: 'r2', clienteId: 'B', quitadoPor: 'oficina' },
    ]);
  });

  it('el recado cambia sin mover el orden', () => {
    expect(
      planearReemplazo(
        [fila('r1', 'A', 1)],
        [{ clienteId: 'A', recado: 'Solo contado' }],
        sinSemanal,
      ).actualizar,
    ).toEqual([{ id: 'r1', orden: 1, recado: 'Solo contado' }]);
  });
});
