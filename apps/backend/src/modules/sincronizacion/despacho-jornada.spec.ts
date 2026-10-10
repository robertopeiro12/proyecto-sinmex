import { CODIGOS_RECHAZO } from './contrato';
import { CODIGO_POR_RAZON_JORNADA, prepararJornada } from './despacho-jornada';
import type { OperacionNormalizada } from './operaciones';

const VEHICULO = '106c93f1-0c9a-4efc-b167-8c73eea9b023';

const op = (datos: Record<string, unknown> = {}): OperacionNormalizada => ({
  clave: 'c0ffee00-0000-4000-8000-000000000038',
  tipo: 'jornada',
  fechaOperacion: '2026-10-10',
  ocurridoEn: '2026-10-10T18:19:55.706Z',
  clienteId: null,
  folio: null,
  datos: {
    vehiculo_id: VEHICULO,
    km_inicial: 128450,
    km_final: 128512,
    abierta_en: '2026-10-10T18:03:53.458Z',
    cerrada_en: '2026-10-10T18:19:55.706Z',
    ...datos,
  },
});

describe('prepararJornada (T-38)', () => {
  it('una jornada valida se prepara para JornadasService', () => {
    expect(prepararJornada(op())).toEqual({
      ok: true,
      jornada: {
        vehiculoId: VEHICULO,
        kmInicial: 128450,
        kmFinal: 128512,
        abiertaEn: '2026-10-10T18:03:53.458Z',
        cerradaEn: '2026-10-10T18:19:55.706Z',
      },
    });
  });

  it('un problema de forma es jornada-datos-invalidos, no el generico datos-invalidos', () => {
    const r = prepararJornada(op({ vehiculo_id: undefined }));
    expect(r).toMatchObject({ ok: false, codigo: 'jornada-datos-invalidos' });
    if (r.ok) throw new Error('debia rechazarse');
    expect(r.motivo).toContain('vehiculo_id');
  });

  it('km final menor al inicial es jornada-km-invalido', () => {
    expect(
      prepararJornada(op({ km_inicial: 200, km_final: 100 })),
    ).toMatchObject({ ok: false, codigo: 'jornada-km-invalido' });
  });
});

describe('CODIGO_POR_RAZON_JORNADA', () => {
  it('cada razon del dominio sale con un codigo que existe en el contrato', () => {
    for (const codigo of Object.values(CODIGO_POR_RAZON_JORNADA)) {
      expect(CODIGOS_RECHAZO).toContain(codigo);
    }
    expect(CODIGO_POR_RAZON_JORNADA).toEqual({
      'vehiculo-inexistente': 'vehiculo-inexistente',
      'jornada-duplicada': 'jornada-duplicada',
    });
  });
});
