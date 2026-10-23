import { CODIGOS_RECHAZO } from './contrato';
import {
  CODIGO_POR_RAZON_MOVIMIENTO,
  prepararMovimiento,
} from './despacho-movimiento';
import type { OperacionNormalizada } from './operaciones';

const CLIENTE = '0b7f5e2a-3c1d-4e8f-9a6b-1c2d3e4f5a6b';
const LITRO = '5f3c1a2b-7d8e-4f90-a1b2-c3d4e5f60718';

const op = (
  extra: Partial<OperacionNormalizada> = {},
): OperacionNormalizada => ({
  clave: 'c0ffee00-0000-4000-8000-000000002700',
  tipo: 'movimiento',
  fechaOperacion: '2026-10-23',
  ocurridoEn: '2026-10-23T18:40:00.000Z',
  clienteId: CLIENTE,
  folio: null,
  datos: {
    tipo: 'merma_cliente',
    comentario: null,
    registrado_en: '2026-10-23T18:40:00.000Z',
    lineas: [{ presentacion_id: LITRO, sentido: 'recibido', piezas: 3 }],
  },
  ...extra,
});

const consumo = {
  tipo: 'consumo',
  registrado_en: '2026-10-23T18:40:00.000Z',
  lineas: [{ presentacion_id: LITRO, sentido: 'entregado', piezas: 1 }],
};

describe('prepararMovimiento (T-27 pieza 2)', () => {
  it('una merma del cliente sale con el cliente del sobre', () => {
    expect(prepararMovimiento(op())).toEqual({
      ok: true,
      clienteId: CLIENTE,
      movimiento: {
        tipo: 'merma_cliente',
        comentario: null,
        registradoEn: '2026-10-23T18:40:00.000Z',
        lineas: [{ presentacionId: LITRO, sentido: 'recibido', piezas: 3 }],
      },
    });
  });

  it('un consumo sin cliente sale con clienteId null', () => {
    expect(
      prepararMovimiento(op({ clienteId: null, datos: consumo })),
    ).toMatchObject({
      ok: true,
      clienteId: null,
      movimiento: { tipo: 'consumo' },
    });
  });

  it.each([
    [{ folio: 'TJ261023AP01' }, /^folio: /],
    [{ clave: 'movimiento-123' }, /^clave: .*uuid/],
    [{ clienteId: null }, /^cliente_id: /],
    [{ datos: consumo }, /^cliente_id: /],
    [{ datos: { ...consumo, tipo: 'cambio' } }, /^tipo: /],
  ])(
    '%j es datos-invalidos con un motivo que nombra el campo',
    (extra, motivo) => {
      const r = prepararMovimiento(op(extra));
      expect(r).toMatchObject({ ok: false, codigo: 'datos-invalidos' });
      if (!r.ok) expect(r.motivo).toMatch(motivo);
    },
  );

  it('cada razon del dominio sale con un codigo que existe en el contrato', () => {
    for (const codigo of Object.values(CODIGO_POR_RAZON_MOVIMIENTO)) {
      expect(CODIGOS_RECHAZO).toContain(codigo);
    }
    expect(CODIGO_POR_RAZON_MOVIMIENTO).toEqual({
      'presentacion-inexistente': 'datos-invalidos',
      'movimiento-id-ocupado': 'movimiento-id-ocupado',
    });
  });
});
