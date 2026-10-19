import { CODIGOS_RECHAZO } from './contrato';
import { CODIGO_POR_RAZON_VISITA, prepararVisita } from './despacho-visita';
import type { OperacionNormalizada } from './operaciones';

const CLIENTE = '0b7f5e2a-3c1d-4e8f-9a6b-1c2d3e4f5a6b';
const MOTIVO = '5d1c9a7e-3b2f-4c8d-9e0a-1b2c3d4e5f60';

const op = (
  extra: Partial<OperacionNormalizada> = {},
): OperacionNormalizada => ({
  clave: 'c0ffee00-0000-4000-8000-000000000039',
  tipo: 'visita',
  fechaOperacion: '2026-10-17',
  ocurridoEn: '2026-10-17T18:40:00.000Z',
  clienteId: CLIENTE,
  folio: null,
  datos: {
    motivo_visita_id: MOTIVO,
    visitada_en: '2026-10-17T18:40:00.000Z',
    lat: null,
    lng: null,
    direccion_texto: 'Frente al parque',
  },
  ...extra,
});

describe('prepararVisita (T-39, D3)', () => {
  it('una visita valida sale con su cliente del sobre', () => {
    expect(prepararVisita(op())).toMatchObject({
      ok: true,
      clienteId: CLIENTE,
      visita: { motivoVisitaId: MOTIVO, direccionTexto: 'Frente al parque' },
    });
  });

  it.each([
    [{ folio: 'TJ261017AP01' }, /^folio: /],
    [{ clienteId: null }, /^cliente_id: /],
    [{ clave: 'visita-123' }, /^clave: .*uuid/],
    [
      {
        datos: {
          motivo_visita_id: MOTIVO,
          visitada_en: '2026-10-17T18:40:00Z',
        },
      },
      /^direccion_texto: /,
    ],
  ])(
    '%o es datos-invalidos con un motivo que nombra el campo',
    (extra, motivo) => {
      const r = prepararVisita(op(extra));
      expect(r).toMatchObject({ ok: false, codigo: 'datos-invalidos' });
      if (r.ok) return;
      expect(r.motivo).toMatch(motivo);
    },
  );

  it('cada razon del dominio sale con un codigo que existe en el contrato', () => {
    for (const codigo of Object.values(CODIGO_POR_RAZON_VISITA)) {
      expect(CODIGOS_RECHAZO).toContain(codigo);
    }
  });
});
