import { textoPromocion } from './promociones-texto';

describe('textoPromocion (T-74)', () => {
  it('por cada N de un producto, M del mismo, se repite', () => {
    expect(
      textoPromocion(
        {
          audiencia: 'todos',
          compraTipo: 'producto',
          compraCantidad: 10,
          regaloTipo: 'mismo',
          regaloCantidad: 1,
          seRepite: true,
        },
        { compra: 'Jawa', regalo: null },
      ),
    ).toBe('Por cada 10 Jawa, 1 Jawa gratis');
  });

  it('al comprar N de una presentacion, M de la misma, una vez', () => {
    expect(
      textoPromocion(
        {
          audiencia: 'cliente',
          compraTipo: 'presentacion',
          compraCantidad: 10,
          regaloTipo: 'mismo',
          regaloCantidad: 1,
          seRepite: false,
        },
        { compra: 'Jawa 600 ml', regalo: null },
      ),
    ).toBe('Al comprar 10 Jawa 600 ml, 1 Jawa 600 ml gratis (una vez)');
  });

  it('por cada N piezas de lo que sea, M de una presentacion', () => {
    expect(
      textoPromocion(
        {
          audiencia: 'todos',
          compraTipo: 'cualquiera',
          compraCantidad: 20,
          regaloTipo: 'presentacion',
          regaloCantidad: 1,
          seRepite: true,
        },
        { compra: null, regalo: 'Jawa 1 L' },
      ),
    ).toBe('Por cada 20 piezas de lo que sea, 1 Jawa 1 L gratis');
  });

  it('por cada pieza (singular), M de un producto', () => {
    expect(
      textoPromocion(
        {
          audiencia: 'todos',
          compraTipo: 'cualquiera',
          compraCantidad: 1,
          regaloTipo: 'producto',
          regaloCantidad: 1,
          seRepite: true,
        },
        { compra: null, regalo: 'Horchata' },
      ),
    ).toBe('Por cada pieza, 1 Horchata gratis');
  });

  it('bienvenida al prospecto sin compra', () => {
    expect(
      textoPromocion(
        {
          audiencia: 'prospecto',
          compraTipo: 'cualquiera',
          compraCantidad: 0,
          regaloTipo: 'presentacion',
          regaloCantidad: 2,
          seRepite: false,
        },
        { compra: null, regalo: 'Jawa 600 ml' },
      ),
    ).toBe('Bienvenida al prospecto: 2 Jawa 600 ml gratis en su primera venta');
  });

  it('bienvenida al prospecto con compra', () => {
    expect(
      textoPromocion(
        {
          audiencia: 'prospecto',
          compraTipo: 'producto',
          compraCantidad: 5,
          regaloTipo: 'mismo',
          regaloCantidad: 1,
          seRepite: false,
        },
        { compra: 'Jawa', regalo: null },
      ),
    ).toBe(
      'Bienvenida al prospecto: al comprar 5 Jawa, 1 Jawa gratis en su primera venta',
    );
  });

  it('sin nombre resuelto no revienta: deja un hueco visible', () => {
    expect(
      textoPromocion(
        {
          audiencia: 'todos',
          compraTipo: 'producto',
          compraCantidad: 10,
          regaloTipo: 'mismo',
          regaloCantidad: 1,
          seRepite: true,
        },
        { compra: null, regalo: null },
      ),
    ).toBe('Por cada 10 (producto), 1 (producto) gratis');
  });
});
