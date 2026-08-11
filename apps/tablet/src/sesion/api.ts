/**
 * Cliente HTTP de los endpoints de autenticacion de la **app** (`/auth/app/*`).
 *
 * > [!important] Tokens, no cookies
 * > El portal usa cookies httpOnly con dominio padre compartido. Una app nativa
 * > no tiene navegador, ni dominio, ni proteccion de origen: las cookies ahi no
 * > aportan nada y ademas obligarian a un almacen de cookies persistente que la
 * > app no controla. La app manda el token en `Authorization: Bearer` y lo
 * > guarda ella misma cifrado (ver `almacen.ts`).
 */
import type { PoliticaSesion, VendedorSesion } from './politica';

/** Falla de red / servidor inalcanzable. Distinta de "credenciales malas". */
export class SinRedError extends Error {
  constructor(causa?: unknown) {
    super('No se pudo contactar al servidor.');
    this.name = 'SinRedError';
    this.cause = causa;
  }
}

/** El servidor respondio y dijo que no. */
export class CredencialesInvalidasError extends Error {
  constructor(mensaje = 'Login o contrasena incorrectos.') {
    super(mensaje);
    this.name = 'CredencialesInvalidasError';
  }
}

export interface RespuestaAuthApp {
  vendedor: VendedorSesion;
  tokenAcceso: string;
  accesoExpiraEn: string;
  tokenRefresh: string;
  sesionExpiraEn: string;
  politica: PoliticaSesion;
}

export interface ClienteAuthApp {
  login(login: string, password: string): Promise<RespuestaAuthApp>;
  refrescar(tokenRefresh: string): Promise<RespuestaAuthApp>;
  cerrarSesion(tokenRefresh: string): Promise<void>;
}

/**
 * URL del backend.
 *
 * `EXPO_PUBLIC_API_URL` se incrusta en el bundle al empaquetar. El default
 * apunta a localhost, que **solo funciona en un emulador**: en una tablet real
 * hay que apuntarlo a la IP del servidor en la red del negocio (ver el README
 * de la app).
 */
export const URL_API = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

/** Vuelca lo que responde el backend al tipo que usa la app. */
interface CuerpoAuthApp {
  vendedor: {
    id: string;
    login: string;
    nombre: string;
    sucursal: { id: string; codigo: string; nombre: string };
  };
  tokenAcceso: string;
  accesoExpiraEn: string;
  tokenRefresh: string;
  sesionExpiraEn: string;
  politica: PoliticaSesion;
}

function adaptar(cuerpo: CuerpoAuthApp): RespuestaAuthApp {
  return {
    vendedor: {
      id: cuerpo.vendedor.id,
      login: cuerpo.vendedor.login,
      nombre: cuerpo.vendedor.nombre,
      sucursalId: cuerpo.vendedor.sucursal.id,
      sucursalCodigo: cuerpo.vendedor.sucursal.codigo,
      sucursalNombre: cuerpo.vendedor.sucursal.nombre,
    },
    tokenAcceso: cuerpo.tokenAcceso,
    accesoExpiraEn: cuerpo.accesoExpiraEn,
    tokenRefresh: cuerpo.tokenRefresh,
    sesionExpiraEn: cuerpo.sesionExpiraEn,
    politica: cuerpo.politica,
  };
}

/**
 * Tiempo maximo de espera de una peticion.
 *
 * Sin esto, una WiFi que asocia pero no enruta (el caso tipico al salir del
 * negocio) dejaria al vendedor mirando un spinner en vez de caer al login
 * offline. 8 s es tolerable para un humano y suficiente para una red lenta.
 */
const TIMEOUT_MS = 8000;

async function pedir<T>(ruta: string, cuerpo: unknown, base: string): Promise<T> {
  const control = new AbortController();
  const alarma = setTimeout(() => control.abort(), TIMEOUT_MS);

  let respuesta: Response;
  try {
    respuesta = await fetch(`${base}${ruta}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo),
      signal: control.signal,
    });
  } catch (error) {
    // Cualquier fallo de transporte (DNS, timeout, sin ruta) es "no hay red".
    throw new SinRedError(error);
  } finally {
    clearTimeout(alarma);
  }

  if (respuesta.status === 401) {
    throw new CredencialesInvalidasError();
  }
  if (!respuesta.ok) {
    // Un 500 no es "credenciales malas" ni "sin red", pero para el vendedor la
    // salida es la misma que sin red: intentar la sesion local. Se reporta como
    // SinRedError para no borrarle su sesion offline por una caida del backend.
    throw new SinRedError(new Error(`El servidor respondio ${respuesta.status}.`));
  }

  return (await respuesta.json()) as T;
}

export function crearClienteAuthApp(base: string = URL_API): ClienteAuthApp {
  return {
    async login(login, password) {
      return adaptar(await pedir<CuerpoAuthApp>('/auth/app/login', { login, password }, base));
    },
    async refrescar(tokenRefresh) {
      return adaptar(await pedir<CuerpoAuthApp>('/auth/app/refresh', { tokenRefresh }, base));
    },
    async cerrarSesion(tokenRefresh) {
      await pedir<unknown>('/auth/app/logout', { tokenRefresh }, base);
    },
  };
}
