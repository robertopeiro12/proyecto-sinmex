import { faltantesDeVentaPortal, mensajeFaltantes } from './inventario-venta';

const A = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const B = '3f2504e0-4f89-41d3-9a0c-0305e82c3302';
const C = '3f2504e0-4f89-41d3-9a0c-0305e82c3303';

const linea = (
  presentacionId: string,
  cantidad: number,
  cantidadPromocion = 0,
) => ({
  presentacionId,
  cantidad,
  cantidadPromocion,
});

describe('faltantesDeVentaPortal (registrar)', () => {
  const existencias = new Map([
    [A, 10],
    [B, 3],
  ]);

  it('alcanza justo: sin faltantes', () => {
    expect(
      faltantesDeVentaPortal(existencias, [linea(A, 8, 2), linea(B, 3)]),
    ).toEqual([]);
  });

  it('cuenta vendidas MAS regaladas', () => {
    expect(faltantesDeVentaPortal(existencias, [linea(A, 9, 2)])).toEqual([
      { presentacionId: A, faltan: 1 },
    ]);
  });

  it('una presentacion sin carga falta completa', () => {
    expect(faltantesDeVentaPortal(existencias, [linea(C, 0, 4)])).toEqual([
      { presentacionId: C, faltan: 4 },
    ]);
  });

  it('una existencia negativa cuenta como 0', () => {
    expect(faltantesDeVentaPortal(new Map([[A, -5]]), [linea(A, 2)])).toEqual([
      { presentacionId: A, faltan: 2 },
    ]);
  });

  it('una linea en 0 no pide nada; en el orden de las lineas', () => {
    expect(
      faltantesDeVentaPortal(existencias, [
        linea(C, 0, 0),
        linea(B, 5),
        linea(A, 11),
      ]),
    ).toEqual([
      { presentacionId: B, faltan: 2 },
      { presentacionId: A, faltan: 1 },
    ]);
  });
});

describe('faltantesDeVentaPortal (editar)', () => {
  // La existencia ya descuenta la propia venta (6 de A): sin ella hay 10.
  const existencias = new Map([[A, 4]]);
  const propias = [linea(A, 5, 1)];

  it('suma de vuelta la propia venta: subir hasta lo que hay pasa', () => {
    expect(
      faltantesDeVentaPortal(existencias, [linea(A, 10)], propias),
    ).toEqual([]);
  });

  it('subir por encima de lo que hay sin la propia venta falta', () => {
    expect(
      faltantesDeVentaPortal(existencias, [linea(A, 10, 2)], propias),
    ).toEqual([{ presentacionId: A, faltan: 2 }]);
  });

  it('bajar piezas nunca se rechaza, aunque el vendedor ya este en negativo', () => {
    expect(
      faltantesDeVentaPortal(new Map([[A, -20]]), [linea(A, 3)], propias),
    ).toEqual([]);
    expect(
      faltantesDeVentaPortal(new Map([[A, -20]]), [linea(A, 6)], propias),
    ).toEqual([]);
  });

  it('cambiar a otra presentacion cuenta contra la existencia de la nueva', () => {
    expect(
      faltantesDeVentaPortal(
        new Map([
          [A, 4],
          [B, 1],
        ]),
        [linea(B, 3)],
        propias,
      ),
    ).toEqual([{ presentacionId: B, faltan: 2 }]);
  });

  it('sin propias (otro vendedor) la existencia se toma tal cual', () => {
    expect(faltantesDeVentaPortal(existencias, [linea(A, 6)])).toEqual([
      { presentacionId: A, faltan: 2 },
    ]);
  });
});

describe('mensajeFaltantes', () => {
  it('como la app: nombre, faltan N; singular con 1', () => {
    const nombres: Record<string, string> = {
      [A]: 'Horchata 1 L',
      [B]: 'Jamaica 500 ml',
    };
    expect(
      mensajeFaltantes(
        'Ana',
        [
          { presentacionId: A, faltan: 3 },
          { presentacionId: B, faltan: 1 },
        ],
        (id) => nombres[id],
      ),
    ).toBe(
      'No le alcanza el producto a Ana: Horchata 1 L, faltan 3; Jamaica 500 ml, falta 1.',
    );
  });
});
