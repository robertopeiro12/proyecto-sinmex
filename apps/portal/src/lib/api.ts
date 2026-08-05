export interface UsuarioSesion {
  id: string;
  login: string;
  nombre: string;
  perfil: string;
  sucursal: { id: string; codigo: string; nombre: string } | null;
}

export class ErrorApi extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

// Rutas publicas de autenticacion: un 401 aqui no significa "sesion vencida",
// significa "credenciales invalidas" (login) o "no hay sesion que renovar"
// (refresh). Reintentar via /auth/refresh en estos casos no tiene sentido y
// solo genera una peticion de mas en el camino mas comun del formulario. Si
// mas adelante hay mas rutas publicas (p. ej. la app tablet), se agregan aqui.
const RUTAS_PUBLICAS_AUTH = ["/auth/login", "/auth/refresh"];

/**
 * Llama a la API con las cookies de sesion. Ante un 401 intenta refrescar
 * UNA vez y reintenta; si tampoco funciona, propaga el 401 para que quien
 * llame mande al login.
 */
export async function apiFetch<T>(ruta: string, init: RequestInit = {}): Promise<T> {
  const enviar = () =>
    fetch(`${API}${ruta}`, {
      ...init,
      credentials: "include",
      headers: { "Content-Type": "application/json", ...init.headers },
    });

  let res = await enviar();

  if (res.status === 401 && !RUTAS_PUBLICAS_AUTH.includes(ruta)) {
    const refrescado = await fetch(`${API}/auth/refresh`, {
      method: "POST",
      credentials: "include",
    });
    if (refrescado.ok) {
      res = await enviar();
    }
  }

  if (!res.ok) {
    throw new ErrorApi(`La peticion a ${ruta} fallo`, res.status);
  }

  return (await res.json()) as T;
}
