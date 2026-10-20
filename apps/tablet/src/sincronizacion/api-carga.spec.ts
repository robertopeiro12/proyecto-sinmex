/**
 * Como traduce el cliente de la respuesta a una carga (T-27) los codigos del
 * servidor. Lo que importa es el reparto: un 409 leido como "sin red" haria que
 * la tablet reintentara con la version vieja en vez de mostrar la nueva.
 */
import { SinRedError } from '@/sesion/api';

import { crearClienteCargas } from './api-carga';
import type { CargaPull } from './contrato';

const CARGA: CargaPull = {
  id: 'carga-1',
  vendedor_id: 'ven-1',
  fecha: '2026-10-22',
  numero: 1,
  estado: 'aceptada',
  motivo_rechazo: null,
  version: 1,
  respondida_en: '2026-10-22T15:00:00.000Z',
  activo: 1,
  lineas: [{ presentacion_id: 'pre-1', piezas: 24 }],
};

const fetchOriginal = globalThis.fetch;

function conRespuesta(status: number, cuerpo: unknown) {
  const fetchFalso = jest.fn((_url: string, _init: RequestInit) =>
    Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(cuerpo),
    } as unknown as Response),
  );
  globalThis.fetch = fetchFalso as unknown as typeof fetch;
  return fetchFalso;
}

const responder = () =>
  crearClienteCargas('http://servidor').responder('token', 'carga-1', { version: 1, accion: 'aceptar' });

afterEach(() => {
  globalThis.fetch = fetchOriginal;
});

describe('cliente de la respuesta a una carga', () => {
  it('manda el cuerpo con el Bearer de siempre a /sync/cargas/:id/respuesta', async () => {
    const fetchFalso = conRespuesta(200, CARGA);
    await responder();
    const [url, init] = fetchFalso.mock.calls[0]!;
    expect(url).toBe('http://servidor/sync/cargas/carga-1/respuesta');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer token');
    expect(JSON.parse(init.body as string)).toEqual({ version: 1, accion: 'aceptar' });
  });

  it('200 es la carga respondida', async () => {
    conRespuesta(200, CARGA);
    await expect(responder()).resolves.toEqual({ tipo: 'ok', carga: CARGA });
  });

  it('Review Focus 2: 409 es "cambio" y trae la carga actual del cuerpo', async () => {
    const nueva = { ...CARGA, estado: 'pendiente' as const, version: 2, respondida_en: null };
    conRespuesta(409, { message: 'La carga cambió…', carga: nueva });
    await expect(responder()).resolves.toEqual({ tipo: 'cambio', carga: nueva });
  });

  it('409 sin carga legible sigue siendo "cambio"', async () => {
    conRespuesta(409, { message: 'otra cosa' });
    await expect(responder()).resolves.toEqual({ tipo: 'cambio', carga: null });
  });

  it('404 es "inexistente", 401 es "sesion" y 400 trae el mensaje', async () => {
    conRespuesta(404, { message: 'No existe esa carga.' });
    await expect(responder()).resolves.toEqual({ tipo: 'inexistente' });
    conRespuesta(401, {});
    await expect(responder()).resolves.toEqual({ tipo: 'sesion' });
    conRespuesta(400, { message: ['Para rechazar la carga escribe el motivo (hasta 300 caracteres).'] });
    await expect(responder()).resolves.toEqual({
      tipo: 'invalida',
      mensaje: 'Para rechazar la carga escribe el motivo (hasta 300 caracteres).',
    });
  });

  it('un 500 o la red caida son SinRedError', async () => {
    conRespuesta(500, {});
    await expect(responder()).rejects.toBeInstanceOf(SinRedError);
    globalThis.fetch = jest.fn(() => Promise.reject(new Error('sin wifi'))) as unknown as typeof fetch;
    await expect(responder()).rejects.toBeInstanceOf(SinRedError);
  });
});
