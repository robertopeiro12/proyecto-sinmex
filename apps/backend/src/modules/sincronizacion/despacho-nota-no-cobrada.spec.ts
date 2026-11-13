import { CODIGOS_RECHAZO } from './contrato';
import {
  CODIGO_POR_RAZON_NOTA_NO_COBRADA,
  prepararNotaNoCobrada,
} from './despacho-nota-no-cobrada';
import type { OperacionNormalizada } from './operaciones';

const CLIENTE = '0b7f5e2a-3c1d-4e8f-9a6b-1c2d3e4f5a6b';
const NOTA = '5d1c9a7e-3b2f-4c8d-9e0a-1b2c3d4e5f60';

const op = (
  extra: Partial<OperacionNormalizada> = {},
): OperacionNormalizada => ({
  clave: 'c0ffee00-0000-4000-8000-000000000113',
  tipo: 'nota-no-cobrada',
  fechaOperacion: '2026-11-13',
  ocurridoEn: '2026-11-13T18:40:00.000Z',
  clienteId: CLIENTE,
  folio: null,
  datos: {
    venta_nota_id: NOTA,
    comentario: 'No estaba',
    registrado_en: '2026-11-13T18:40:00.000Z',
  },
  ...extra,
});

describe('prepararNotaNoCobrada', () => {
  it('una operacion valida sale con el cliente del sobre', () => {
    expect(prepararNotaNoCobrada(op())).toMatchObject({
      ok: true,
      clienteId: CLIENTE,
      nota: { ventaNotaId: NOTA, comentario: 'No estaba' },
    });
  });

  it.each([
    [{ folio: 'TJ261113AP01' }, /^folio: /],
    [{ clienteId: null }, /^cliente_id: /],
    [{ clave: 'nota-123' }, /^clave: .*uuid/],
    [
      {
        datos: {
          venta_nota_id: NOTA,
          comentario: '  ',
          registrado_en: '2026-11-13T18:40:00Z',
        },
      },
      /^comentario: /,
    ],
  ])(
    '%o es datos-invalidos con un motivo que nombra el campo',
    (extra, motivo) => {
      const r = prepararNotaNoCobrada(op(extra));
      expect(r).toMatchObject({ ok: false, codigo: 'datos-invalidos' });
      if (r.ok) return;
      expect(r.motivo).toMatch(motivo);
    },
  );

  it('cada razon del dominio sale con un codigo que existe en el contrato', () => {
    for (const codigo of Object.values(CODIGO_POR_RAZON_NOTA_NO_COBRADA)) {
      expect(CODIGOS_RECHAZO).toContain(codigo);
    }
  });
});
