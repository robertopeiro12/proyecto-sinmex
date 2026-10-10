import { KM_MAXIMO, normalizarDatosJornada } from './datos-jornada';

const VEHICULO = '106c93f1-0c9a-4efc-b167-8c73eea9b023';

/** El sobre que manda hoy la tablet (`fuente-jornadas.ts`), con lo que se quiera cambiar encima. */
const datos = (
  extra: Record<string, unknown> = {},
): Record<string, unknown> => ({
  vehiculo_id: VEHICULO,
  km_inicial: 128450,
  km_final: 128512,
  abierta_en: '2026-10-10T18:03:53.458Z',
  cerrada_en: '2026-10-10T18:19:55.706Z',
  ...extra,
});

describe('normalizarDatosJornada (T-38)', () => {
  it('una jornada cerrada valida se normaliza', () => {
    expect(normalizarDatosJornada(datos())).toEqual({
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

  it('el uuid del vehiculo se guarda en minusculas y los instantes en UTC', () => {
    const r = normalizarDatosJornada(
      datos({
        vehiculo_id: VEHICULO.toUpperCase(),
        abierta_en: '2026-10-10T08:03:53.458-07:00',
        cerrada_en: '2026-10-10T18:19:55-07:00',
      }),
    );
    expect(r).toMatchObject({
      ok: true,
      jornada: {
        vehiculoId: VEHICULO,
        abiertaEn: '2026-10-10T15:03:53.458Z',
        cerradaEn: '2026-10-11T01:19:55.000Z',
      },
    });
  });

  it('acepta decimales, el km final igual al inicial y el tope de numeric(10,1)', () => {
    expect(
      normalizarDatosJornada(
        datos({ km_inicial: 128_712.5, km_final: 128_712.5 }),
      ),
    ).toMatchObject({
      ok: true,
      jornada: { kmInicial: 128_712.5, kmFinal: 128_712.5 },
    });
    expect(
      normalizarDatosJornada(datos({ km_inicial: 0, km_final: KM_MAXIMO })),
    ).toMatchObject({ ok: true });
  });

  it('ignora cualquier otro campo (el buzon le agrega cliente_id: null)', () => {
    expect(
      normalizarDatosJornada(datos({ cliente_id: null, lo_que_sea: 1 })),
    ).toMatchObject({ ok: true });
  });

  it.each<[string, Record<string, unknown>, string]>([
    ['sin vehiculo', { vehiculo_id: undefined }, 'vehiculo_id: '],
    ['vehiculo que no es uuid', { vehiculo_id: 'veh-1' }, 'vehiculo_id: '],
    ['km inicial como texto', { km_inicial: '128450' }, 'km_inicial: '],
    ['km inicial negativo', { km_inicial: -1 }, 'km_inicial: '],
    ['km inicial NaN', { km_inicial: Number.NaN }, 'km_inicial: '],
    ['sin km final', { km_final: undefined }, 'km_final: '],
    ['km final nulo', { km_final: null }, 'km_final: '],
    [
      'km final que no cabe en numeric(10,1)',
      { km_final: 1_000_000_000 },
      'km_final: ',
    ],
    ['km final infinito', { km_final: Number.POSITIVE_INFINITY }, 'km_final: '],
    [
      'apertura sin zona',
      { abierta_en: '2026-10-10T08:03:53' },
      'abierta_en: ',
    ],
    ['apertura que no es instante', { abierta_en: 'ayer' }, 'abierta_en: '],
    [
      'apertura en un dia que no existe',
      { abierta_en: '2026-02-30T08:00:00Z' },
      'abierta_en: ',
    ],
    ['sin cierre', { cerrada_en: null }, 'cerrada_en: '],
    ['cierre solo con fecha', { cerrada_en: '2026-10-10' }, 'cerrada_en: '],
  ])('%s es un problema de forma y nombra el campo', (_caso, extra, campo) => {
    const r = normalizarDatosJornada(datos(extra));
    expect(r).toMatchObject({ ok: false, falla: 'forma' });
    if (r.ok) throw new Error('debia rechazarse');
    expect(r.motivo.startsWith(campo)).toBe(true);
  });

  it('km final menor al inicial es una falla de km, no de forma', () => {
    const r = normalizarDatosJornada(
      datos({ km_inicial: 128512, km_final: 128450 }),
    );
    expect(r).toMatchObject({ ok: false, falla: 'km' });
    if (r.ok) throw new Error('debia rechazarse');
    expect(r.motivo).toContain('km_final');
  });

  it('si la forma tambien esta mal, manda la forma: los km solo se comparan legibles', () => {
    expect(
      normalizarDatosJornada(
        datos({ km_inicial: 128512, km_final: 128450, cerrada_en: 'nunca' }),
      ),
    ).toMatchObject({ ok: false, falla: 'forma' });
  });
});
