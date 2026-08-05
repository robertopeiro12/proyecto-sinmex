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

  if (res.status === 401 && ruta !== "/auth/refresh") {
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
