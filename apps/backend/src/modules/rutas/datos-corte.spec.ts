import {
  MAX_NOTAS_CORTE,
  MAX_RENGLONES_CORTE,
  normalizarDatosCorte,
} from './datos-corte';

const PRE_A = '5d1c9a7e-3b2f-4c8d-9e0a-1b2c3d4e5f01';
const PRE_B = '5d1c9a7e-3b2f-4c8d-9e0a-1b2c3d4e5f02';

/** Lo que manda la tablet (`fuente-cortes.ts`), con lo que se quiera cambiar encima. */
const datos = (
  extra: Record<string, unknown> = {},
): Record<string, unknown> => ({
  efectivo: { esperado_centavos: 432500, traido_centavos: 430000 },
  notas: [
    { folio: 'TJ261125AP01', traida: true, saldo_centavos: 30000 },
    { folio: 'TJ261125AP02', traida: false, saldo_centavos: 0 },
  ],
  inventario: [
    { presentacion_id: PRE_A, sistema: 8, contado: 7 },
    { presentacion_id: PRE_B, sistema: 0, contado: 2 },
  ],
  merma: { sistema: 5, contado: 5 },
  enviado_en: '2026-11-26T01:30:00.000Z',
  ...extra,
});

describe('normalizarDatosCorte (rediseño pieza 6)', () => {
  it('un corte valido se normaliza', () => {
    expect(normalizarDatosCorte(datos())).toEqual({
      ok: true,
      corte: {
        efectivo: { esperadoCentavos: 432500, traidoCentavos: 430000 },
        notas: [
          { folio: 'TJ261125AP01', traida: true, saldoCentavos: 30000 },
          { folio: 'TJ261125AP02', traida: false, saldoCentavos: 0 },
        ],
        inventario: [
          { presentacionId: PRE_A, sistema: 8, contado: 7 },
          { presentacionId: PRE_B, sistema: 0, contado: 2 },
        ],
        merma: { sistema: 5, contado: 5 },
        enviadoEn: '2026-11-26T01:30:00.000Z',
      },
    });
  });

  it('el efectivo esperado puede ser negativo (los gastos pasaron lo cobrado)', () => {
    const r = normalizarDatosCorte(
      datos({ efectivo: { esperado_centavos: -5000, traido_centavos: 0 } }),
    );
    expect(r.ok && r.corte.efectivo).toEqual({
      esperadoCentavos: -5000,
      traidoCentavos: 0,
    });
  });

  it('sin notas ni inventario tambien es un corte (un vendedor que vendio todo de contado)', () => {
    const r = normalizarDatosCorte(datos({ notas: [], inventario: [] }));
    expect(r.ok).toBe(true);
  });

  it('el folio se recorta, el uuid baja a minusculas y el instante se normaliza a UTC', () => {
    const r = normalizarDatosCorte(
      datos({
        notas: [{ folio: ' TJ261125AP01 ', traida: true, saldo_centavos: 1 }],
        inventario: [
          { presentacion_id: PRE_A.toUpperCase(), sistema: 1, contado: 1 },
        ],
        enviado_en: '2026-11-25T17:30:00-08:00',
      }),
    );
    expect(r).toMatchObject({
      ok: true,
      corte: {
        notas: [{ folio: 'TJ261125AP01' }],
        inventario: [{ presentacionId: PRE_A }],
        enviadoEn: '2026-11-26T01:30:00.000Z',
      },
    });
  });

  it.each([
    [{ efectivo: null }, /^efectivo: /],
    [
      { efectivo: { esperado_centavos: 1.5, traido_centavos: 0 } },
      /^efectivo\.esperado_centavos: /,
    ],
    [
      { efectivo: { esperado_centavos: 0, traido_centavos: -1 } },
      /^efectivo\.traido_centavos: /,
    ],
    [
      { efectivo: { esperado_centavos: 0, traido_centavos: '10' } },
      /^efectivo\.traido_centavos: /,
    ],
    [{ notas: 'ninguna' }, /^notas: /],
    [{ notas: [null] }, /^notas\[0\]: /],
    [
      { notas: [{ folio: '  ', traida: true, saldo_centavos: 0 }] },
      /^notas\[0\]\.folio: /,
    ],
    [
      { notas: [{ folio: 'X'.repeat(21), traida: true, saldo_centavos: 0 }] },
      /^notas\[0\]\.folio: /,
    ],
    [
      { notas: [{ folio: 'TJ1', traida: 'si', saldo_centavos: 0 }] },
      /^notas\[0\]\.traida: /,
    ],
    [
      { notas: [{ folio: 'TJ1', traida: true, saldo_centavos: -1 }] },
      /^notas\[0\]\.saldo_centavos: /,
    ],
    [{ inventario: {} }, /^inventario: /],
    [
      { inventario: [{ presentacion_id: 'pre-1', sistema: 1, contado: 1 }] },
      /^inventario\[0\]\.presentacion_id: /,
    ],
    [
      { inventario: [{ presentacion_id: PRE_A, sistema: -1, contado: 1 }] },
      /^inventario\[0\]\.sistema: /,
    ],
    [
      { inventario: [{ presentacion_id: PRE_A, sistema: 1, contado: 2.5 }] },
      /^inventario\[0\]\.contado: /,
    ],
    [
      {
        inventario: [
          { presentacion_id: PRE_A, sistema: 1, contado: 1 },
          { presentacion_id: PRE_A.toUpperCase(), sistema: 1, contado: 1 },
        ],
      },
      /^inventario\[1\]\.presentacion_id: .*repetida/,
    ],
    [{ merma: undefined }, /^merma: /],
    [{ merma: { sistema: 1, contado: null } }, /^merma\.contado: /],
    [{ merma: { sistema: -2, contado: 0 } }, /^merma\.sistema: /],
    [{ enviado_en: '2026-11-25T17:30:00' }, /^enviado_en: /],
    [{ enviado_en: '2026-02-30T17:30:00Z' }, /^enviado_en: /],
  ])('%j es invalido con un motivo que nombra el campo', (extra, motivo) => {
    const r = normalizarDatosCorte(datos(extra));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toMatch(motivo);
  });

  it('pone tope a las notas y a los renglones de inventario', () => {
    const notas = Array.from({ length: MAX_NOTAS_CORTE + 1 }, (_, i) => ({
      folio: `F${i}`,
      traida: true,
      saldo_centavos: 0,
    }));
    const r1 = normalizarDatosCorte(datos({ notas }));
    expect(!r1.ok && r1.motivo).toMatch(/^notas: /);

    const inventario = Array.from(
      { length: MAX_RENGLONES_CORTE + 1 },
      (_, i) => ({
        presentacion_id: `5d1c9a7e-3b2f-4c8d-9e0a-${String(i).padStart(12, '0')}`,
        sistema: 0,
        contado: 0,
      }),
    );
    const r2 = normalizarDatosCorte(datos({ inventario }));
    expect(!r2.ok && r2.motivo).toMatch(/^inventario: /);
  });
});
