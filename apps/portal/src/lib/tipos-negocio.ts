import { apiFetch } from "./api";

// Copia normativa de `TipoNegocio` en
// apps/backend/src/modules/cartera-clientes/tipos-negocio.repository.ts —
// mismo trato que el resto de `lib/*.ts` (ver CLAUDE.md, T-07).
export interface TipoNegocio {
  id: string;
  nombre: string;
}

export function listarTiposNegocio(): Promise<TipoNegocio[]> {
  return apiFetch<TipoNegocio[]>("/tipos-negocio");
}

export function crearTipoNegocio(nombre: string): Promise<TipoNegocio> {
  return apiFetch<TipoNegocio>("/tipos-negocio", {
    method: "POST",
    body: JSON.stringify({ nombre }),
  });
}
