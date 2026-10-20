/**
 * Cliente de `POST /sync/cargas/:id/respuesta` (T-27, D6): aceptar o rechazar
 * la carga, con red y en el momento.
 *
 * Mismo transporte que `api.ts` (`Authorization: Bearer`, fallo de red =
 * `SinRedError`), pero devuelve los demas codigos como **resultado** y no como
 * error: cada uno lleva a la pantalla por un camino distinto (409 muestra la
 * carga nueva, 404 se resincroniza, 401 sincroniza para renovar). Este cliente
 * nunca renueva la sesion por su cuenta.
 */
import { SinRedError, URL_API } from '@/sesion/api';

import type { CargaPull, CuerpoRespuestaCarga } from './contrato';

export type ResultadoApiCarga =
  | { tipo: 'ok'; carga: CargaPull }
  /** 409: el portal la edito o ya tiene otra respuesta. `carga` = la actual, si vino. */
  | { tipo: 'cambio'; carga: CargaPull | null }
  /** 404: de otro vendedor, inexistente o eliminada. */
  | { tipo: 'inexistente' }
  | { tipo: 'invalida'; mensaje: string }
  /** 401: el token de acceso ya no vale. */
  | { tipo: 'sesion' };

export interface ClienteCargas {
  responder(
    tokenAcceso: string,
    cargaId: string,
    cuerpo: CuerpoRespuestaCarga,
  ): Promise<ResultadoApiCarga>;
}

/** Una peticion chica sobre el WiFi de la planta: 15 s bastan. */
const TIMEOUT_MS = 15_000;

async function leerCuerpo(respuesta: Response): Promise<unknown> {
  try {
    return await respuesta.json();
  } catch {
    return null;
  }
}

function mensajeDe(cuerpo: unknown, status: number): string {
  const mensaje = (cuerpo as { message?: unknown } | null)?.message;
  if (typeof mensaje === 'string') return mensaje;
  if (Array.isArray(mensaje)) return mensaje.filter((m) => typeof m === 'string').join(' ');
  return `El servidor respondio ${status}.`;
}

export function crearClienteCargas(base: string = URL_API): ClienteCargas {
  return {
    async responder(tokenAcceso, cargaId, cuerpo) {
      const control = new AbortController();
      const alarma = setTimeout(() => control.abort(), TIMEOUT_MS);
      let respuesta: Response;
      try {
        respuesta = await fetch(`${base}/sync/cargas/${encodeURIComponent(cargaId)}/respuesta`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${tokenAcceso}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(cuerpo),
          signal: control.signal,
        });
      } catch (error) {
        throw new SinRedError(error);
      } finally {
        clearTimeout(alarma);
      }

      if (respuesta.ok) return { tipo: 'ok', carga: (await respuesta.json()) as CargaPull };
      if (respuesta.status === 401) return { tipo: 'sesion' };
      if (respuesta.status === 404) return { tipo: 'inexistente' };
      if (respuesta.status === 409) {
        const actual = (await leerCuerpo(respuesta)) as { carga?: CargaPull } | null;
        return { tipo: 'cambio', carga: actual?.carga ?? null };
      }
      if (respuesta.status === 400) {
        return { tipo: 'invalida', mensaje: mensajeDe(await leerCuerpo(respuesta), 400) };
      }
      // 5xx y lo demas: para el vendedor es lo mismo que sin red (reintentar).
      throw new SinRedError(new Error(`El servidor respondio ${respuesta.status}.`));
    },
  };
}
