import {
  armarVentaEditada,
  pctComisionTrasEdicion,
  planDetalle,
  type LineaGuardada,
} from './edicion-venta';

const CLIENTE = '0b7f5e2a-3c1d-4e8f-9a6b-1c2d3e4f5a6b';
const PRE_A = '5f3c1a2b-7d8e-4f90-a1b2-c3d4e5f60718';
const PRE_B = '6a4d2b3c-8e9f-4a01-b2c3-d4e5f6071829';
const PRE_SIN = '7b5e3c4d-9fa0-4b12-83d4-e5f60718293a';
const PRE_BAJA = '8c6f4d5e-a0b1-4c23-94e5-f60718293a4b';

/** La lista del cliente HOY a la fecha de la venta: PRE_A subio a 11.00. */
const precios = new Map<string, number | null>([
  [PRE_A, 1100],
  [PRE_B, 600],
  [PRE_SIN, null],
]);

const guardada = (
  presentacionId: string,
  precioCentavos: number,
  cantidad = 24,
  cantidadPromocion = 0,
): LineaGuardada => ({
  id: `linea-${presentacionId.slice(0, 4)}`,
  presentacionId,
  cantidad,
  cantidadPromocion,
  precioCentavos,
});

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

describe('armarVentaEditada: precios de una edicion (T-17 parte 2, §4.2 paso 4)', () => {
  it('una linea existente conserva su precio guardado aunque la lista haya cambiado', () => {
    const r = armarVentaEditada(
      entrada([{ presentacionId: PRE_A, cantidad: 3, cantidadPromocion: 1 }]),
      [guardada(PRE_A, 1000)],
      precios,
      '2024-03-06',
    );
    expect(r).toEqual({
      ok: true,
      venta: expect.objectContaining({
        lineas: [
          {
            presentacionId: PRE_A,
            cantidad: 3,
            cantidadPromocion: 1,
            precioCentavos: 1000,
          },
        ],
      }) as unknown,
    });
  });

  it('una presentacion nueva toma el precio de la lista a la fecha', () => {
    const r = armarVentaEditada(
      entrada([
        { presentacionId: PRE_A, cantidad: 1, cantidadPromocion: 0 },
        { presentacionId: PRE_B, cantidad: 4, cantidadPromocion: 0 },
      ]),
      [guardada(PRE_A, 1000)],
      precios,
      '2024-03-06',
    );
    expect(r.ok && r.venta.lineas.map((l) => l.precioCentavos)).toEqual([
      1000, 600,
    ]);
  });

  // Review Focus 1
  it('una linea existente se conserva aunque su presentacion ya no se venda', () => {
    const r = armarVentaEditada(
      entrada([
        { presentacionId: PRE_BAJA, cantidad: 2, cantidadPromocion: 0 },
      ]),
      [guardada(PRE_BAJA, 850)],
      precios,
      '2024-03-06',
    );
    expect(r.ok && r.venta.lineas[0].precioCentavos).toBe(850);
  });

  it('una presentacion NUEVA que ya no se vende es presentacion-inactiva', () => {
    const r = armarVentaEditada(
      entrada([
        { presentacionId: PRE_BAJA, cantidad: 2, cantidadPromocion: 0 },
      ]),
      [],
      precios,
      '2024-03-06',
    );
    expect(r).toMatchObject({
      ok: false,
      tipo: 'rechazo',
      rechazo: { razon: 'presentacion-inactiva' },
    });
  });

  it('una presentacion nueva con piezas y sin precio a la fecha es precio-no-asignado, con la fecha', () => {
    const r = armarVentaEditada(
      entrada([{ presentacionId: PRE_SIN, cantidad: 1, cantidadPromocion: 0 }]),
      [],
      precios,
      '2024-03-06',
    );
    expect(r).toEqual({
      ok: false,
      tipo: 'rechazo',
      rechazo: {
        razon: 'precio-no-asignado',
        motivo:
          'Una de las presentaciones nuevas no tiene precio en la lista del cliente para el 2024-03-06.',
      },
    });
  });

  it('una presentacion nueva de pura promocion entra a 0 aunque no tenga precio (D13)', () => {
    const r = armarVentaEditada(
      entrada([{ presentacionId: PRE_SIN, cantidad: 0, cantidadPromocion: 2 }]),
      [],
      precios,
      '2024-03-06',
    );
    expect(r.ok && r.venta.lineas[0].precioCentavos).toBe(0);
  });

  // Review Focus 3
  it('una linea de promocion ($0) que gana piezas vendidas toma la lista a la fecha', () => {
    const r = armarVentaEditada(
      entrada([{ presentacionId: PRE_B, cantidad: 5, cantidadPromocion: 2 }]),
      [guardada(PRE_B, 0, 0, 2)],
      precios,
      '2024-03-06',
    );
    expect(r.ok && r.venta.lineas[0].precioCentavos).toBe(600);
  });

  it('una linea de promocion ($0) que sigue sin piezas vendidas conserva su 0', () => {
    const r = armarVentaEditada(
      entrada([{ presentacionId: PRE_SIN, cantidad: 0, cantidadPromocion: 5 }]),
      [guardada(PRE_SIN, 0, 0, 2)],
      precios,
      '2024-03-06',
    );
    expect(r.ok && r.venta.lineas[0].precioCentavos).toBe(0);
  });

  it('el uuid en mayusculas encuentra su linea guardada', () => {
    const r = armarVentaEditada(
      entrada([
        {
          presentacionId: PRE_A.toUpperCase(),
          cantidad: 2,
          cantidadPromocion: 0,
        },
      ]),
      [guardada(PRE_A, 1000)],
      precios,
      '2024-03-06',
    );
    expect(r.ok && r.venta.lineas[0]).toEqual({
      presentacionId: PRE_A,
      cantidad: 2,
      cantidadPromocion: 0,
      precioCentavos: 1000,
    });
  });

  it('las mismas reglas de forma que la tablet: presentacion repetida es invalido', () => {
    const r = armarVentaEditada(
      entrada([
        { presentacionId: PRE_A, cantidad: 1, cantidadPromocion: 0 },
        { presentacionId: PRE_A, cantidad: 2, cantidadPromocion: 0 },
      ]),
      [guardada(PRE_A, 1000)],
      precios,
      '2024-03-06',
    );
    expect(r).toMatchObject({ ok: false, tipo: 'invalido' });
  });
});

describe('pctComisionTrasEdicion (§4.2 paso 6)', () => {
  const VENDEDOR = 'a1a1a1a1-0000-4000-8000-000000000001';
  const OTRO = 'b2b2b2b2-0000-4000-8000-000000000002';

  it('mismo vendedor: conserva el % congelado', () => {
    expect(
      pctComisionTrasEdicion(
        { vendedorId: VENDEDOR, pctComision: '3.50' },
        VENDEDOR,
        '4.25',
      ),
    ).toBe('3.50');
  });

  it('pasa a Oficina: null', () => {
    expect(
      pctComisionTrasEdicion(
        { vendedorId: VENDEDOR, pctComision: '3.50' },
        null,
        '4.25',
      ),
    ).toBeNull();
  });

  it('de Oficina a un vendedor: el % actual del cliente', () => {
    expect(
      pctComisionTrasEdicion(
        { vendedorId: null, pctComision: null },
        VENDEDOR,
        '4.25',
      ),
    ).toBe('4.25');
  });

  it('de un vendedor a otro: el % actual del cliente', () => {
    expect(
      pctComisionTrasEdicion(
        { vendedorId: VENDEDOR, pctComision: '3.50' },
        OTRO,
        '4.25',
      ),
    ).toBe('4.25');
  });

  it('Oficina sigue en Oficina: null', () => {
    expect(
      pctComisionTrasEdicion(
        { vendedorId: null, pctComision: null },
        null,
        '4.25',
      ),
    ).toBeNull();
  });
});

describe('planDetalle (§4.2 paso 7)', () => {
  it('borra las que ya no vienen, actualiza las que siguen e inserta las nuevas', () => {
    const plan = planDetalle(
      [guardada(PRE_A, 1000), guardada(PRE_B, 600)],
      [
        {
          presentacionId: PRE_A,
          cantidad: 3,
          cantidadPromocion: 1,
          precioCentavos: 1000,
        },
        {
          presentacionId: PRE_SIN,
          cantidad: 0,
          cantidadPromocion: 2,
          precioCentavos: 0,
        },
      ],
    );
    expect(plan).toEqual({
      borrar: [`linea-${PRE_B.slice(0, 4)}`],
      actualizar: [
        {
          id: `linea-${PRE_A.slice(0, 4)}`,
          cantidad: 3,
          cantidadPromocion: 1,
          precioCentavos: 1000,
        },
      ],
      insertar: [
        {
          presentacionId: PRE_SIN,
          cantidad: 0,
          cantidadPromocion: 2,
          precioCentavos: 0,
        },
      ],
    });
  });
});
