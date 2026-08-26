import { apiFetch } from "./api";

// Copia normativa de las formas que devuelve
// apps/backend/src/modules/auth/perfiles.repository.ts y perfiles.service.ts
// -- sin tipo compartido entre backend y portal, mismo trato que lib/precios.ts.
export interface Permiso {
  id: string;
  clave: string;
  grupo: string;
  descripcion: string | null;
}

export interface Perfil {
  id: string;
  nombre: string;
  esMaestro: boolean;
  permisos: string[];
}

export interface MatrizPerfiles {
  permisos: Permiso[];
  perfiles: Perfil[];
}

export function obtenerPerfiles(): Promise<MatrizPerfiles> {
  return apiFetch<MatrizPerfiles>("/perfiles");
}

// POST /perfiles y PATCH /perfiles/:id devuelven PerfilResumen ({id, nombre}
// nada mas -- ver perfiles.controller.ts), no la forma completa de `Perfil`
// (que trae esMaestro/permisos, solo presente en la respuesta de GET
// /perfiles). Tipar estas dos como Promise<Perfil> dejaria a un futuro
// caller leer `.esMaestro`/`.permisos` de un perfil recien creado o
// renombrado sin error de compilacion, y obtener `undefined` en runtime.
export function crearPerfil(
  nombre: string,
): Promise<{ id: string; nombre: string }> {
  return apiFetch("/perfiles", {
    method: "POST",
    body: JSON.stringify({ nombre }),
  });
}

export function renombrarPerfil(
  id: string,
  nombre: string,
): Promise<{ id: string; nombre: string }> {
  return apiFetch(`/perfiles/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ nombre }),
  });
}

export function darDeBajaPerfil(id: string): Promise<{ id: string }> {
  return apiFetch<{ id: string }>(`/perfiles/${id}`, { method: "DELETE" });
}

export function togglePermiso(
  perfilId: string,
  permisoId: string,
  habilitado: boolean,
): Promise<{ perfilId: string; permisoId: string; habilitado: boolean }> {
  return apiFetch(`/perfiles/${perfilId}/permisos`, {
    method: "PATCH",
    body: JSON.stringify({ permisoId, habilitado }),
  });
}
