import { CODIGOS_RECHAZO } from './contrato';
import { CODIGO_POR_RAZON_CORTE, prepararCorte } from './despacho-corte';
import type { OperacionNormalizada } from './operaciones';

const PRE_A = '5d1c9a7e-3b2f-4c8d-9e0a-1b2c3d4e5f01';

const op = (
  extra: Partial<OperacionNormalizada> = {},
): OperacionNormalizada => ({
  clave: 'c0ffee00-0000-4000-8000-000000000060',
  tipo: 'corte',
  fechaOperacion: '2026-11-25',
  ocurridoEn: '2026-11-26T01:30:00.000Z',
  clienteId: null,
  folio: null,
  datos: {
    efectivo: { esperado_centavos: 1000, traido_centavos: 1000 },
    notas: [],
    inventario: [{ presentacion_id: PRE_A, sistema: 3, contado: 3 }],
    merma: { sistema: 0, contado: 0 },
    enviado_en: '2026-11-26T01:30:00.000Z',
  },
  ...extra,
});

describe('prepararCorte (rediseño pieza 6)', () => {
  it('un corte valido sale con sus datos normalizados', () => {
    expect(prepararCorte(op())).toEqual({
      ok: true,
      corte: {
        efectivo: { esperadoCentavos: 1000, traidoCentavos: 1000 },
        notas: [],
        inventario: [{ presentacionId: PRE_A, sistema: 3, contado: 3 }],
        merma: { sistema: 0, contado: 0 },
        enviadoEn: '2026-11-26T01:30:00.000Z',
      },
    });
  });

  it.each([
    [{ folio: 'TJ261125AP01' }, /^folio: /],
    [{ clienteId: '0b7f5e2a-3c1d-4e8f-9a6b-1c2d3e4f5a6b' }, /^cliente_id: /],
    [{ clave: 'corte-123' }, /^clave: .*uuid/],
    [{ datos: { efectivo: null } }, /^efectivo: /],
  ])(
    '%j es datos-invalidos con un motivo que nombra el campo',
    (extra, motivo) => {
      const r = prepararCorte(op(extra));
      expect(r).toMatchObject({ ok: false, codigo: 'datos-invalidos' });
      if (!r.ok) expect(r.motivo).toMatch(motivo);
    },
  );

  it('cada razon del dominio tiene un codigo del contrato', () => {
    expect(CODIGO_POR_RAZON_CORTE).toEqual({
      'corte-duplicado': 'corte-duplicado',
      'id-ocupado': 'datos-invalidos',
    });
    for (const codigo of Object.values(CODIGO_POR_RAZON_CORTE)) {
      expect(CODIGOS_RECHAZO).toContain(codigo);
    }
  });
});
