import { armarVentaPortal, revisarFechaVenta } from './venta-portal';

const CLIENTE = '0b7f5e2a-3c1d-4e8f-9a6b-1c2d3e4f5a6b';
const PRE_A = '5f3c1a2b-7d8e-4f90-a1b2-c3d4e5f60718';
const PRE_B = '6a4d2b3c-8e9f-4a01-b2c3-d4e5f6071829';
const PRE_SIN = '7b5e3c4d-9fa0-4b12-83d4-e5f60718293a';

const precios = new Map<string, number | null>([
  [PRE_A, 1000],
  [PRE_B, 600],
  [PRE_SIN, null],
]);

const entrada = (
  lineas: {
    presentacionId: string;
    cantidad: number;
    cantidadPromocion: number;
  }[],
) => ({
  clienteId: CLIENTE,
  numNota: '1234',
  contadoCredito: 'credito' as const,
  factura: 'N/A' as const,
  comentarios: null,
  lineas,
});

describe('armarVentaPortal: lineas con el precio del servidor (T-17, §4.2)', () => {
  it('pone a cada linea el precio de la lista del cliente a la fecha', () => {
    const r = armarVentaPortal(
      entrada([
        { presentacionId: PRE_A, cantidad: 24, cantidadPromocion: 2 },
        { presentacionId: PRE_B, cantidad: 5, cantidadPromocion: 0 },
      ]),
      precios,
      '2025-02-10',
    );
    expect(r).toEqual({
      ok: true,
      venta: {
        clienteId: CLIENTE,
        numNota: '1234',
        contadoCredito: 'credito',
        factura: 'N/A',
        comentarios: null,
        lineas: [
          {
            presentacionId: PRE_A,
            cantidad: 24,
            cantidadPromocion: 2,
            precioCentavos: 1000,
          },
          {
            presentacionId: PRE_B,
            cantidad: 5,
            cantidadPromocion: 0,
            precioCentavos: 600,
          },
        ],
      },
    });
  });

  it('acepta el uuid en mayusculas: el mapa de precios va en minusculas', () => {
    const r = armarVentaPortal(
      entrada([
        {
          presentacionId: PRE_A.toUpperCase(),
          cantidad: 1,
          cantidadPromocion: 0,
        },
      ]),
      precios,
      '2025-02-10',
    );
    expect(r.ok && r.venta.lineas[0]).toEqual({
      presentacionId: PRE_A,
      cantidad: 1,
      cantidadPromocion: 0,
      precioCentavos: 1000,
    });
  });

  it('una linea de pura promocion sin precio entra a precio 0 (D13)', () => {
    const r = armarVentaPortal(
      entrada([{ presentacionId: PRE_SIN, cantidad: 0, cantidadPromocion: 3 }]),
      precios,
      '2025-02-10',
    );
    expect(r.ok && r.venta.lineas[0].precioCentavos).toBe(0);
  });

  it('una linea con piezas y sin precio a esa fecha es precio-no-asignado, con motivo para la oficina', () => {
    const r = armarVentaPortal(
      entrada([{ presentacionId: PRE_SIN, cantidad: 1, cantidadPromocion: 0 }]),
      precios,
      '2025-02-10',
    );
    expect(r).toEqual({
      ok: false,
      tipo: 'rechazo',
      rechazo: {
        razon: 'precio-no-asignado',
        motivo:
          'Una de las presentaciones no tiene precio en la lista del cliente para el 2025-02-10.',
      },
    });
  });

  it('una presentacion que no se vende es presentacion-inactiva', () => {
    const r = armarVentaPortal(
      entrada([
        {
          presentacionId: '8c6f4d5e-a0b1-4c23-94e5-f60718293a4b',
          cantidad: 1,
          cantidadPromocion: 0,
        },
      ]),
      precios,
      '2025-02-10',
    );
    expect(r).toMatchObject({
      ok: false,
      tipo: 'rechazo',
      rechazo: { razon: 'presentacion-inactiva' },
    });
  });

  it('reusa las reglas de forma de la tablet: presentacion repetida es invalida', () => {
    const r = armarVentaPortal(
      entrada([
        { presentacionId: PRE_A, cantidad: 1, cantidadPromocion: 0 },
        { presentacionId: PRE_A, cantidad: 2, cantidadPromocion: 0 },
      ]),
      precios,
      '2025-02-10',
    );
    expect(r).toMatchObject({ ok: false, tipo: 'invalido' });
    if (r.ok || r.tipo !== 'invalido') throw new Error('debia ser invalido');
    expect(r.motivo).toContain('lineas[1].presentacion_id');
  });

  it('reusa las reglas de forma de la tablet: una linea en 0 y 0 es invalida', () => {
    const r = armarVentaPortal(
      entrada([{ presentacionId: PRE_A, cantidad: 0, cantidadPromocion: 0 }]),
      precios,
      '2025-02-10',
    );
    expect(r).toMatchObject({ ok: false, tipo: 'invalido' });
  });
});

describe('revisarFechaVenta (T-17, §3)', () => {
  it.each(['2026-10-06', '2025-02-10'])(
    '%s, hoy o pasada, se acepta',
    (fecha) => {
      expect(revisarFechaVenta(fecha, '2026-10-06')).toBeNull();
    },
  );

  it('mañana se rechaza: "hoy" es el de Tijuana, aunque en UTC ya sea mañana', () => {
    expect(revisarFechaVenta('2026-10-07', '2026-10-06')).toBe(
      'La fecha de la venta no puede ser futura.',
    );
  });

  it.each(['', '06/10/2026', '2026-10-6'])(
    '"%s" no tiene el formato',
    (fecha) => {
      expect(revisarFechaVenta(fecha, '2026-10-06')).toBe(
        'La fecha debe tener el formato AAAA-MM-DD.',
      );
    },
  );

  it('antes de 2000-01-01 se rechaza: el folio solo lleva AAMMDD', () => {
    expect(revisarFechaVenta('1999-12-31', '2026-10-06')).toBe(
      'La fecha de la venta no puede ser anterior al 2000-01-01.',
    );
    expect(revisarFechaVenta('1926-10-06', '2026-10-06')).not.toBeNull();
    expect(revisarFechaVenta('2000-01-01', '2026-10-06')).toBeNull();
  });

  it('una fecha que no existe se rechaza', () => {
    expect(revisarFechaVenta('2026-02-30', '2026-10-06')).toBe(
      'Esa fecha no existe.',
    );
  });
});
