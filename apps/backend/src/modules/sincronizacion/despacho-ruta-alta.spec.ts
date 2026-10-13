import { CODIGOS_RECHAZO } from './contrato';
import { CODIGO_POR_RAZON_RUTA, prepararRutaAlta } from './despacho-ruta-alta';
import type { OperacionNormalizada } from './operaciones';

const CLIENTE = '0b7f5e2a-3c1d-4e8f-9a6b-1c2d3e4f5a6b';

const op = (
  extra: Partial<OperacionNormalizada> = {},
): OperacionNormalizada => ({
  clave: 'c0ffee00-0000-4000-8000-000000000037',
  tipo: 'ruta-alta',
  fechaOperacion: '2026-10-12',
  ocurridoEn: '2026-10-12T16:05:00.000Z',
  clienteId: null,
  folio: null,
  datos: { cliente_id: CLIENTE },
  ...extra,
});

describe('prepararRutaAlta (T-37)', () => {
  it('un alta valida se prepara para RutasDiariasService', () => {
    expect(prepararRutaAlta(op())).toEqual({
      ok: true,
      alta: { clienteId: CLIENTE },
    });
  });

  it('datos sin cliente es ruta-datos-invalidos, no el generico datos-invalidos', () => {
    const r = prepararRutaAlta(op({ datos: {} }));
    expect(r).toMatchObject({ ok: false, codigo: 'ruta-datos-invalidos' });
    if (r.ok) throw new Error('debia rechazarse');
    expect(r.motivo).toContain('cliente_id');
  });

  it('un alta con folio es ruta-datos-invalidos: no es una nota que nadie firme', () => {
    expect(prepararRutaAlta(op({ folio: 'TJ261012AP01' }))).toMatchObject({
      ok: false,
      codigo: 'ruta-datos-invalidos',
    });
  });

  it('un cliente en el sobre que no coincide con el de datos es ruta-datos-invalidos', () => {
    expect(
      prepararRutaAlta(
        op({ clienteId: '11111111-1111-4111-8111-111111111111' }),
      ),
    ).toMatchObject({ ok: false, codigo: 'ruta-datos-invalidos' });
  });

  it('el mismo cliente en el sobre y en datos se acepta', () => {
    expect(prepararRutaAlta(op({ clienteId: CLIENTE }))).toMatchObject({
      ok: true,
    });
  });

  it('cada razon del dominio sale con un codigo que existe en el contrato', () => {
    for (const codigo of Object.values(CODIGO_POR_RAZON_RUTA)) {
      expect(CODIGOS_RECHAZO).toContain(codigo);
    }
  });
});
