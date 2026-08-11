/**
 * Cliente HTTP de `/sync/pull` y `/sync/push`.
 *
 * Mismo criterio que `src/sesion/api.ts`: el token viaja en
 * `Authorization: Bearer` (una app nativa no tiene cookies que la protejan), y
 * cualquier fallo de transporte se reporta como `SinRedError` para que la app
 * pueda seguir trabajando offline en vez de tratarlo como un error fatal.
 */
import { SinRedError, URL_API } from '@/sesion/api';

import {
  CONTRATO_ACTUAL,
  type OperacionSaliente,
  type RespuestaPull,
  type RespuestaPush,
} from './contrato';

/**
 * El servidor y la tablet no hablan la misma version del contrato.
 *
 * Es un error **que no se arregla reintentando**, a diferencia de la falta de
 * red: hay que actualizar uno de los dos lados. Por eso tiene su propia clase —
 * si se colara como `SinRedError`, la tablet reintentaria en cada
 * sincronizacion, para siempre, sin que nadie se enterara del porque.
 */
export class ContratoIncompatibleError extends Error {
  constructor(readonly detalle: string) {
    super(detalle);
    this.name = 'ContratoIncompatibleError';
  }
}

/** El servidor rechazo la sesion (token vencido, vendedor de baja). */
export class SesionRechazadaError extends Error {
  constructor() {
    super('El servidor rechazo la sesion.');
    this.name = 'SesionRechazadaError';
  }
}

/** El servidor rechazo el alcance: se pidio algo de otra sucursal o vendedor. */
export class FueraDeAlcanceError extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'FueraDeAlcanceError';
  }
}

export interface ClienteSync {
  pull(tokenAcceso: string, desde: string | null): Promise<RespuestaPull>;
  push(tokenAcceso: string, operaciones: OperacionSaliente[]): Promise<RespuestaPush>;
}

/**
 * Mas generoso que el de la autenticacion (8 s).
 *
 * Un pull completo de una sucursal con cientos de clientes y sus precios no es
 * una peticion pequena, y esto ocurre sobre la WiFi del negocio con la tablet
 * recien llegada. Cortarlo a los 8 s dejaria al vendedor sin catalogos por
 * impaciencia del cliente.
 */
const TIMEOUT_MS = 30_000;

async function pedir<T>(
  url: string,
  tokenAcceso: string,
  cuerpo: unknown | undefined,
): Promise<T> {
  const control = new AbortController();
  const alarma = setTimeout(() => control.abort(), TIMEOUT_MS);

  let respuesta: Response;
  try {
    respuesta = await fetch(url, {
      method: cuerpo === undefined ? 'GET' : 'POST',
      headers: {
        Authorization: `Bearer ${tokenAcceso}`,
        ...(cuerpo === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
      signal: control.signal,
    });
  } catch (error) {
    throw new SinRedError(error);
  } finally {
    clearTimeout(alarma);
  }

  if (respuesta.status === 401) throw new SesionRechazadaError();

  if (respuesta.status === 403) {
    throw new FueraDeAlcanceError(await mensajeDe(respuesta));
  }

  if (respuesta.status === 409) {
    throw new ContratoIncompatibleError(await mensajeDe(respuesta));
  }

  if (!respuesta.ok) {
    // 400 y 5xx acaban aqui. Para el vendedor la salida es la misma que sin
    // red —seguir trabajando offline y reintentar— asi que no se le rompe la
    // jornada por una caida del backend.
    throw new SinRedError(new Error(`El servidor respondio ${respuesta.status}.`));
  }

  return (await respuesta.json()) as T;
}

async function mensajeDe(respuesta: Response): Promise<string> {
  try {
    const cuerpo = (await respuesta.json()) as { message?: string | string[] };
    return Array.isArray(cuerpo.message)
      ? cuerpo.message.join(' ')
      : (cuerpo.message ?? `El servidor respondio ${respuesta.status}.`);
  } catch {
    return `El servidor respondio ${respuesta.status}.`;
  }
}

export function crearClienteSync(base: string = URL_API): ClienteSync {
  return {
    async pull(tokenAcceso, desde) {
      const params = new URLSearchParams({ contrato: String(CONTRATO_ACTUAL) });
      if (desde) params.set('desde', desde);
      return pedir<RespuestaPull>(
        `${base}/sync/pull?${params.toString()}`,
        tokenAcceso,
        undefined,
      );
    },

    async push(tokenAcceso, operaciones) {
      return pedir<RespuestaPush>(`${base}/sync/push`, tokenAcceso, {
        contrato: CONTRATO_ACTUAL,
        operaciones,
      });
    },
  };
}
