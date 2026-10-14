import {
  coincidenEnProducto,
  problemaDeRegla,
  type ReglaCompleta,
} from './reglas-promocion';

const base: ReglaCompleta = {
  audiencia: 'todos',
  clienteId: null,
  compraTipo: 'producto',
  compraProductoId: 'p1',
  compraPresentacionId: null,
  compraCantidad: 10,
  regaloTipo: 'mismo',
  regaloProductoId: null,
  regaloPresentacionId: null,
  regaloCantidad: 1,
  seRepite: true,
};

describe('problemaDeRegla (T-74)', () => {
  it('una regla bien formada no tiene problema', () => {
    expect(problemaDeRegla(base)).toBeNull();
  });
  it('del mismo no cabe con cualquier producto', () => {
    expect(
      problemaDeRegla({
        ...base,
        compraTipo: 'cualquiera',
        compraProductoId: null,
      }),
    ).toBe(
      'Si la compra es de cualquier producto, el regalo tiene que ser un producto o una presentación concretos.',
    );
  });
  it('compra por producto exige el producto y no la presentacion', () => {
    expect(problemaDeRegla({ ...base, compraProductoId: null })).toBe(
      'Elige el producto que se compra.',
    );
    expect(problemaDeRegla({ ...base, compraPresentacionId: 'x' })).toBe(
      'Elige el producto que se compra.',
    );
  });
  it('compra por presentacion exige la presentacion', () => {
    expect(
      problemaDeRegla({
        ...base,
        compraTipo: 'presentacion',
        compraProductoId: null,
      }),
    ).toBe('Elige la presentación que se compra.');
  });
  it('regalo por producto / presentacion exige su id', () => {
    expect(problemaDeRegla({ ...base, regaloTipo: 'producto' })).toBe(
      'Elige el producto que se regala.',
    );
    expect(problemaDeRegla({ ...base, regaloTipo: 'presentacion' })).toBe(
      'Elige la presentación que se regala.',
    );
  });
  it('comprar 0 solo vale para prospectos', () => {
    expect(problemaDeRegla({ ...base, compraCantidad: 0 })).toBe(
      'La cantidad de compra debe ser al menos 1; solo la promoción de prospectos puede regalar sin compra.',
    );
    expect(
      problemaDeRegla({
        ...base,
        audiencia: 'prospecto',
        seRepite: false,
        compraCantidad: 0,
        compraTipo: 'cualquiera',
        compraProductoId: null,
        regaloTipo: 'producto',
        regaloProductoId: 'p2',
      }),
    ).toBeNull();
  });
  it('se regala al menos una pieza, enteras', () => {
    expect(problemaDeRegla({ ...base, regaloCantidad: 0 })).toBe(
      'Se regala al menos 1 pieza.',
    );
    expect(problemaDeRegla({ ...base, regaloCantidad: 1.5 })).toBe(
      'Se regala al menos 1 pieza.',
    );
  });
  it('la de prospectos no se repite por bloques', () => {
    expect(
      problemaDeRegla({ ...base, audiencia: 'prospecto', seRepite: true }),
    ).toBe(
      'La promoción de prospectos se da una sola vez, en su primera venta.',
    );
    expect(
      problemaDeRegla({ ...base, audiencia: 'prospecto', seRepite: false }),
    ).toBeNull();
  });
  it('audiencia cliente exige el cliente, y las demas no lo admiten', () => {
    expect(problemaDeRegla({ ...base, audiencia: 'cliente' })).toBe(
      'Elige el cliente de la promoción.',
    );
    expect(problemaDeRegla({ ...base, clienteId: 'c1' })).toBe(
      'Solo una promoción de un cliente lleva cliente.',
    );
  });
});

describe('coincidenEnProducto (D5)', () => {
  it('cualquiera coincide con todo', () => {
    expect(coincidenEnProducto('todos', new Set(['p1']))).toBe(true);
    expect(coincidenEnProducto(new Set(['p1']), 'todos')).toBe(true);
  });
  it('dos conjuntos coinciden si comparten un producto', () => {
    expect(coincidenEnProducto(new Set(['p1']), new Set(['p1']))).toBe(true);
    expect(coincidenEnProducto(new Set(['p1']), new Set(['p2']))).toBe(false);
  });
});
