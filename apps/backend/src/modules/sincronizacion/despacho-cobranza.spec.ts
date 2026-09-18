import { CODIGOS_RECHAZO } from './contrato';
import {
  CODIGO_POR_RAZON_COBRANZA,
  prepararCobranza,
} from './despacho-cobranza';
import type { OperacionNormalizada } from './operaciones';

const CLIENTE = '0b7f5e2a-3c1d-4e8f-9a6b-1c2d3e4f5a6b';
const NOTA = '7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f';

const op = (
  extra: Partial<OperacionNormalizada> = {},
): OperacionNormalizada => ({
  clave: 'c0ffee00-0000-4000-8000-000000000002',
  tipo: 'cobranza',
  fechaOperacion: '2026-09-14',
  ocurridoEn: '2026-09-14T19:10:00.000Z',
  clienteId: CLIENTE,
  folio: 'TJ260914AP04',
  datos: {
    venta_nota_id: NOTA,
    monto_centavos: 15000,
    metodo_pago: 'transferencia',
    fecha_pago: '2026-09-13',
  },
  ...extra,
});

describe('prepararCobranza', () => {
  it('una cobranza valida se prepara para CobranzasService', () => {
    expect(prepararCobranza(op())).toEqual({
      ok: true,
      cobranza: {
        clienteId: CLIENTE,
        ventaNotaId: NOTA,
        montoCentavos: 15000,
        metodoPago: 'transferencia',
        fechaPago: '2026-09-13',
      },
    });
  });

  it.each<[string, Partial<OperacionNormalizada>, string]>([
    ['una cobranza sin folio', { folio: null }, 'folio: '],
    ['una cobranza sin cliente', { clienteId: null }, 'cliente_id: '],
    [
      'una cobranza de $0',
      {
        datos: {
          venta_nota_id: NOTA,
          monto_centavos: 0,
          metodo_pago: 'efectivo',
          fecha_pago: '2026-09-13',
        },
      },
      'monto_centavos: ',
    ],
  ])(
    '%s es datos-invalidos y el motivo dice el campo',
    (_caso, extra, prefijo) => {
      const r = prepararCobranza(op(extra));
      if (r.ok) throw new Error('debia rechazarse');
      expect(r.codigo).toBe('datos-invalidos');
      expect(r.motivo.startsWith(prefijo)).toBe(true);
    },
  );
});

describe('CODIGO_POR_RAZON_COBRANZA', () => {
  it('cada razon del dominio sale con un codigo que existe en el contrato', () => {
    for (const codigo of Object.values(CODIGO_POR_RAZON_COBRANZA)) {
      expect(CODIGOS_RECHAZO).toContain(codigo);
    }
    expect(CODIGO_POR_RAZON_COBRANZA['nota-no-encontrada']).toBe(
      'nota-no-encontrada',
    );
  });
});
