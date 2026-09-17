/**
 * Como traduce el cliente HTTP del sync los codigos del servidor.
 *
 * Lo que importa aqui no es el `fetch` (se sustituye) sino el reparto: que
 * error acaba en cada estado. Un estado en la casilla equivocada no rompe nada
 * visible, solo hace que la tablet reintente para siempre o que borre una
 * sesion buena.
 */
import { SinRedError } from '@/sesion/api';

import {
  ContratoIncompatibleError,
  FueraDeAlcanceError,
  LoteDemasiadoGrandeError,
  SesionRechazadaError,
  crearClienteSync,
} from './api';
import type { OperacionSaliente } from './contrato';

const OPERACION: OperacionSaliente = {
  clave: 'op-1',
  tipo: 'venta',
  fecha_operacion: '2026-08-07',
  ocurrido_en: '2026-08-07T15:00:00.000Z',
  datos: {},
};

const fetchOriginal = globalThis.fetch;

/** Una respuesta con ese estado y un cuerpo que NO es json (como el 413 de Express). */
function respuesta(status: number): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.reject(new Error('el cuerpo no es json')),
  } as unknown as Response;
}

function conEstado(status: number) {
  globalThis.fetch = jest.fn(() =>
    Promise.resolve(respuesta(status)),
  ) as unknown as typeof fetch;
  return crearClienteSync('http://servidor').push('token', [OPERACION]);
}

afterEach(() => {
  globalThis.fetch = fetchOriginal;
});

describe('cliente de sincronizacion: cada estado en su casilla', () => {
  it('413 es un lote demasiado grande, NO falta de red', async () => {
    // Es la diferencia que costaba el bloqueo silencioso de IMPORTANT-1: leido
    // como "sin red", la tablet reenvia el mismo lote para siempre; leido como
    // lo que es, sale a la pantalla y el troceo por bytes lo evita.
    await expect(conEstado(413)).rejects.toBeInstanceOf(LoteDemasiadoGrandeError);
  });

  it('500 sigue siendo "sin red": el vendedor sigue trabajando offline', async () => {
    await expect(conEstado(500)).rejects.toBeInstanceOf(SinRedError);
  });

  it('400 sigue siendo "sin red"', async () => {
    await expect(conEstado(400)).rejects.toBeInstanceOf(SinRedError);
  });

  it('401 tumba la sesion, 403 es alcance y 409 es contrato', async () => {
    await expect(conEstado(401)).rejects.toBeInstanceOf(SesionRechazadaError);
    await expect(conEstado(403)).rejects.toBeInstanceOf(FueraDeAlcanceError);
    await expect(conEstado(409)).rejects.toBeInstanceOf(ContratoIncompatibleError);
  });
});
