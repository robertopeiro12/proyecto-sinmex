import { CODIGOS_RECHAZO } from './contrato';
import { CODIGO_POR_RAZON_GASTO, prepararGasto } from './despacho-gasto';
import type { OperacionNormalizada } from './operaciones';

const CAMPO = '5d1c9a7e-3b2f-4c8d-9e0a-1b2c3d4e5f30';

const op = (
  extra: Partial<OperacionNormalizada> = {},
): OperacionNormalizada => ({
  clave: 'c0ffee00-0000-4000-8000-000000000030',
  tipo: 'gasto',
  fechaOperacion: '2026-10-20',
  ocurridoEn: '2026-10-20T18:40:00.000Z',
  clienteId: null,
  folio: null,
  datos: {
    campo_egreso_id: CAMPO,
    monto_centavos: 8000,
    registrado_en: '2026-10-20T18:40:00.000Z',
    comentario: null,
  },
  ...extra,
});

describe('prepararGasto (T-30/T-31, D5)', () => {
  it('un gasto valido sale con sus datos normalizados', () => {
    expect(prepararGasto(op())).toEqual({
      ok: true,
      gasto: {
        campoEgresoId: CAMPO,
        montoCentavos: 8000,
        registradoEn: '2026-10-20T18:40:00.000Z',
        comentario: null,
      },
    });
  });

  it.each([
    [{ folio: 'TJ261020AP01' }, /^folio: /],
    [{ clienteId: '0b7f5e2a-3c1d-4e8f-9a6b-1c2d3e4f5a6b' }, /^cliente_id: /],
    [{ clave: 'gasto-123' }, /^clave: .*uuid/],
    [
      {
        datos: {
          campo_egreso_id: CAMPO,
          monto_centavos: 0,
          registrado_en: '2026-10-20T18:40:00.000Z',
        },
      },
      /^monto_centavos: /,
    ],
  ])(
    '%j es datos-invalidos con un motivo que nombra el campo',
    (extra, motivo) => {
      const r = prepararGasto(op(extra));
      expect(r).toMatchObject({ ok: false, codigo: 'datos-invalidos' });
      if (!r.ok) expect(r.motivo).toMatch(motivo);
    },
  );

  it('cada razon del dominio sale con un codigo que existe en el contrato', () => {
    for (const codigo of Object.values(CODIGO_POR_RAZON_GASTO)) {
      expect(CODIGOS_RECHAZO).toContain(codigo);
    }
    expect(CODIGO_POR_RAZON_GASTO).toEqual({
      'campo-egreso-inexistente': 'campo-egreso-inexistente',
      'gasto-id-ocupado': 'gasto-id-ocupado',
    });
  });
});
