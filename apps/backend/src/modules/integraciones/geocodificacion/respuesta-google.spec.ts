import { interpretarRespuestaGoogle } from './respuesta-google';

/** Respuesta OK de Google con un resultado del tipo pedido. */
const conTipo = (
  location_type: string,
  lat: unknown = 32.5251234,
  lng: unknown = -117.0213456,
) => ({
  status: 'OK',
  results: [{ geometry: { location: { lat, lng }, location_type } }],
});

describe('interpretarRespuestaGoogle (T-72, D4)', () => {
  it.each(['ROOFTOP', 'RANGE_INTERPOLATED', 'GEOMETRIC_CENTER'])(
    '%s es ok, redondeada a 6 decimales como numeric(9,6)',
    (tipo) => {
      expect(interpretarRespuestaGoogle(conTipo(tipo))).toEqual({
        estado: 'ok',
        lat: 32.525123,
        lng: -117.021346,
      });
    },
  );

  it('APPROXIMATE (colonia o ciudad) es imprecisa: una coordenada mala es peor que ninguna', () => {
    expect(interpretarRespuestaGoogle(conTipo('APPROXIMATE'))).toEqual({
      estado: 'imprecisa',
    });
  });

  it('solo mira el primer resultado', () => {
    const cuerpo = {
      status: 'OK',
      results: [
        conTipo('APPROXIMATE').results[0],
        conTipo('ROOFTOP').results[0],
      ],
    };
    expect(interpretarRespuestaGoogle(cuerpo)).toEqual({ estado: 'imprecisa' });
  });

  it('ZERO_RESULTS es no-encontrada', () => {
    expect(
      interpretarRespuestaGoogle({ status: 'ZERO_RESULTS', results: [] }),
    ).toEqual({ estado: 'no-encontrada' });
  });

  it.each([
    'REQUEST_DENIED',
    'OVER_QUERY_LIMIT',
    'OVER_DAILY_LIMIT',
    'INVALID_REQUEST',
    'UNKNOWN_ERROR',
  ])('%s es error con el status, sin el error_message de Google', (status) => {
    expect(
      interpretarRespuestaGoogle({
        status,
        error_message: 'The provided API key is invalid.',
        results: [],
      }),
    ).toEqual({ estado: 'error', detalle: `Google respondió ${status}.` });
  });

  it.each([null, 'texto', 42, []])(
    'un cuerpo que no es objeto (%p) es error',
    (cuerpo) => {
      expect(interpretarRespuestaGoogle(cuerpo)).toMatchObject({
        estado: 'error',
      });
    },
  );

  it('sin status es error', () => {
    expect(interpretarRespuestaGoogle({ results: [] })).toEqual({
      estado: 'error',
      detalle: 'Google respondió sin status.',
    });
  });

  it('OK sin resultados o sin coordenada legible es error', () => {
    expect(interpretarRespuestaGoogle({ status: 'OK', results: [] })).toEqual({
      estado: 'error',
      detalle: 'Google respondió OK sin una coordenada legible.',
    });
    expect(
      interpretarRespuestaGoogle(conTipo('ROOFTOP', '32.5', -117)),
    ).toMatchObject({ estado: 'error' });
    expect(
      interpretarRespuestaGoogle(conTipo('ROOFTOP', 32.5, Number.NaN)),
    ).toMatchObject({ estado: 'error' });
  });

  it('una coordenada fuera de la Tierra es error', () => {
    expect(
      interpretarRespuestaGoogle(conTipo('ROOFTOP', 91, -117)),
    ).toMatchObject({ estado: 'error' });
    expect(
      interpretarRespuestaGoogle(conTipo('ROOFTOP', 32, -181)),
    ).toMatchObject({ estado: 'error' });
  });

  it('un location_type desconocido es error, nunca ok', () => {
    expect(interpretarRespuestaGoogle(conTipo('SATELITE'))).toEqual({
      estado: 'error',
      detalle: 'Google respondió un location_type desconocido.',
    });
  });
});
