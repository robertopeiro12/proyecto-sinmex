import { normalizarDatosVisita } from './datos-visita';

const MOTIVO = '5d1c9a7e-3b2f-4c8d-9e0a-1b2c3d4e5f60';

const datos = (extra: Record<string, unknown> = {}) => ({
  motivo_visita_id: MOTIVO,
  visitada_en: '2026-10-17T11:40:00-07:00',
  observaciones: null,
  atendio: null,
  lat: 32.5149,
  lng: -117.0382,
  precision_m: 12.5,
  direccion_texto: null,
  ...extra,
});

function motivoDe(extra: Record<string, unknown>): string {
  const r = normalizarDatosVisita(datos(extra));
  if (r.ok) throw new Error('debia rechazarse');
  return r.motivo;
}

describe('normalizarDatosVisita (T-39, D3)', () => {
  it('una visita con GPS se normaliza: motivo en minusculas, instante en UTC', () => {
    expect(
      normalizarDatosVisita(datos({ motivo_visita_id: MOTIVO.toUpperCase() })),
    ).toEqual({
      ok: true,
      visita: {
        motivoVisitaId: MOTIVO,
        visitadaEn: '2026-10-17T18:40:00.000Z',
        observaciones: null,
        atendio: null,
        lat: 32.5149,
        lng: -117.0382,
        precisionM: 12.5,
        direccionTexto: null,
      },
    });
  });

  it('sin GPS con direccion escrita entra; los textos se recortan y el vacio es null', () => {
    const r = normalizarDatosVisita(
      datos({
        lat: null,
        lng: null,
        precision_m: null,
        direccion_texto: '  Frente al parque  ',
        observaciones: '   ',
        atendio: ' Doña Lupe ',
      }),
    );
    expect(r).toMatchObject({
      ok: true,
      visita: {
        direccionTexto: 'Frente al parque',
        observaciones: null,
        atendio: 'Doña Lupe',
        lat: null,
      },
    });
  });

  it('los opcionales pueden faltar del todo', () => {
    const r = normalizarDatosVisita({
      motivo_visita_id: MOTIVO,
      visitada_en: '2026-10-17T18:40:00Z',
      lat: 32.5,
      lng: -117,
    });
    expect(r).toMatchObject({
      ok: true,
      visita: { observaciones: null, precisionM: null },
    });
  });

  it.each([
    [{ lat: null, lng: null, direccion_texto: null }, 'direccion_texto'],
    [{ lat: null, lng: null, direccion_texto: '    ' }, 'direccion_texto'],
    [{ lng: null }, 'lat'],
    [{ lat: 91 }, 'lat'],
    [{ lng: -181 }, 'lng'],
    [{ lat: Number.NaN }, 'lat'],
    [{ precision_m: -1 }, 'precision_m'],
    [{ precision_m: '12' }, 'precision_m'],
    [{ motivo_visita_id: 'cerrado' }, 'motivo_visita_id'],
    [{ visitada_en: '2026-10-17T18:40:00' }, 'visitada_en'],
    [{ visitada_en: '2026-02-30T18:40:00Z' }, 'visitada_en'],
    [{ observaciones: 'x'.repeat(501) }, 'observaciones'],
    [{ observaciones: 12 }, 'observaciones'],
    [{ atendio: 'x'.repeat(121) }, 'atendio'],
    [{ direccion_texto: 'x'.repeat(301) }, 'direccion_texto'],
  ])('%o se rechaza nombrando el campo %s', (extra, campo) => {
    expect(motivoDe(extra)).toMatch(new RegExp(`^${campo}: `));
  });
});
