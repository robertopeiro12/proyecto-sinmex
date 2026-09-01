import { reconciliarPromocionProductos } from './reconciliar-promocion-productos';

describe('reconciliarPromocionProductos', () => {
  it('en un alta (sin existentes), inserta todos los pedidos si hay promocion', () => {
    const plan = reconciliarPromocionProductos('10+1', [], ['p1', 'p2']);
    expect(plan).toEqual({ insertar: ['p1', 'p2'], eliminar: [] });
  });

  it('con promocion "ninguna", ignora los pedidos aunque manden ids (D4 del spec)', () => {
    const plan = reconciliarPromocionProductos('ninguna', [], ['p1', 'p2']);
    expect(plan).toEqual({ insertar: [], eliminar: [] });
  });

  it('con promocion "ninguna" y productos existentes, los da de baja', () => {
    const plan = reconciliarPromocionProductos(
      'ninguna',
      ['p1', 'p2'],
      ['p1', 'p2'],
    );
    expect(plan).toEqual({ insertar: [], eliminar: ['p1', 'p2'] });
  });

  it('inserta los nuevos y da de baja los que ya no vienen', () => {
    const plan = reconciliarPromocionProductos(
      '20+1',
      ['p1', 'p2'],
      ['p2', 'p3'],
    );
    expect(plan.insertar).toEqual(['p3']);
    expect(plan.eliminar).toEqual(['p1']);
  });

  it('no repite un producto en insertar si ya estaba entre los existentes', () => {
    const plan = reconciliarPromocionProductos('10+1', ['p1'], ['p1']);
    expect(plan).toEqual({ insertar: [], eliminar: [] });
  });

  it('deduplica ids repetidos en los pedidos', () => {
    const plan = reconciliarPromocionProductos('10+1', [], ['p1', 'p1', 'p2']);
    expect(plan.insertar.sort()).toEqual(['p1', 'p2']);
  });
});
