import { apiFetch } from "./api";

// Copia normativa de las formas que devuelve
// apps/backend/src/modules/auth/usuarios.repository.ts y
// perfiles.service.ts (MatrizPerfiles) -- mismo trato que el resto de
// `lib/*.ts` (ver CLAUDE.md, T-07).
export interface UsuarioResumen {
  id: string;
  login: string;
  nombre: string;
  perfil: string;
  perfilId: string;
  sucursalCodigo: string | null;
}

export interface UsuarioDetalle extends UsuarioResumen {
  sucursalId: string | null;
  permisosEfectivos: string[];
}

export interface Permiso {
  id: string;
  clave: string;
  grupo: string;
  descripcion: string | null;
}

export interface PerfilConPermisos {
  id: string;
  nombre: string;
  esMaestro: boolean;
  permisos: string[];
}

export interface CatalogoPerfiles {
  permisos: Permiso[];
  perfiles: PerfilConPermisos[];
}

export function listarUsuarios(sucursal: string | null): Promise<UsuarioResumen[]> {
  const query = sucursal ? `?sucursal=${encodeURIComponent(sucursal)}` : "";
  return apiFetch<UsuarioResumen[]>(`/usuarios${query}`);
}

export function obtenerUsuario(id: string): Promise<UsuarioDetalle> {
  return apiFetch<UsuarioDetalle>(`/usuarios/${id}`);
}

export function obtenerCatalogoPerfiles(): Promise<CatalogoPerfiles> {
  return apiFetch<CatalogoPerfiles>("/usuarios/catalogo-perfiles");
}

/** Lo que arma el formulario de Usuario (Task 10), antes de decidir alta o edición. */
export interface DatosUsuarioFormulario {
  login: string;
  nombre: string;
  /**
   * D2 del spec: ausente = "no cambiar" en edición. `editarUsuario()` NO
   * debe recibir una cadena vacía aquí -- el formulario ya la convierte a
   * `undefined`, que `JSON.stringify` quita del cuerpo por completo.
   */
  contrasena?: string;
  perfilId: string;
  /** Solo presente cuando quien guarda es un actor General (D8). */
  sucursalId?: string;
  permisosMarcados: string[];
}

export function crearUsuario(
  datos: DatosUsuarioFormulario & { contrasena: string },
): Promise<UsuarioDetalle> {
  return apiFetch<UsuarioDetalle>("/usuarios", {
    method: "POST",
    body: JSON.stringify(datos),
  });
}

export function editarUsuario(
  id: string,
  datos: DatosUsuarioFormulario,
): Promise<UsuarioDetalle> {
  return apiFetch<UsuarioDetalle>(`/usuarios/${id}`, {
    method: "PATCH",
    body: JSON.stringify(datos),
  });
}

export function eliminarUsuario(id: string): Promise<void> {
  return apiFetch<void>(`/usuarios/${id}`, { method: "DELETE" });
}
