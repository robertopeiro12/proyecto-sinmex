import { apiFetch } from "./api";

// `ListaPrecio` y `Precio` son una copia normativa de las formas que
// devuelve `apps/backend/src/modules/cartera-clientes/precios.repository.ts`
// (interfaces `ListaPrecio` y `PrecioVigente` de ese archivo). No hay un tipo
// compartido entre backend y portal -- mismo trato que
// `apps/tablet/src/sincronizacion/contrato.ts` frente a
// `apps/backend/src/modules/sincronizacion/contrato.ts` (ver CLAUDE.md, T-07).
// Un cambio de forma en un lado exige el cambio equivalente en el otro; nada
// aqui lo hace cumplir automaticamente.
export interface ListaPrecio {
  id: string;
  nombre: string;
}

export interface Precio {
  presentacionId: string;
  listaPrecioId: string;
  precio: number;
  vigenteDesde: string;
}

export function listarListasPrecio(): Promise<ListaPrecio[]> {
  return apiFetch<ListaPrecio[]>("/listas-precio");
}

/** @param sucursal codigo de la sucursal (nunca vacio: la pantalla no llama esto sin uno). */
export function listarPrecios(sucursal: string): Promise<Precio[]> {
  return apiFetch<Precio[]>(`/precios?sucursal=${encodeURIComponent(sucursal)}`);
}

/**
 * Fecha LOCAL del navegador, NUNCA `toISOString()` (que es UTC). Mismo riesgo
 * de zona horaria que `fecha_operacion` de folios (CLAUDE.md): Tijuana y
 * Mexicali estan detras de UTC, y el backend usa esta fecha tal cual para
 * `vigente_desde` (D3 del spec de T-18).
 *
 * Nota para verificacion manual en maquinas de desarrollo (Europe/Madrid,
 * ADELANTE de UTC, al reves que produccion): entre ~00:00 y ~02:00 hora local
 * esta funcion ya devuelve la fecha de manana, y el filtro del backend
 * (`vigente_desde <= current_date`, en UTC) lo descarta de la matriz al
 * instante -- el guardado si funciono, solo no se ve hasta que la fecha en
 * UTC lo alcance.
 */
function hoyLocalIso(): string {
  const ahora = new Date();
  const mes = String(ahora.getMonth() + 1).padStart(2, "0");
  const dia = String(ahora.getDate()).padStart(2, "0");
  return `${ahora.getFullYear()}-${mes}-${dia}`;
}

export function actualizarPrecio(datos: {
  presentacionId: string;
  listaPrecioId: string;
  sucursalId: string;
  precio: number;
}): Promise<Precio> {
  return apiFetch<Precio>("/precios", {
    method: "PATCH",
    body: JSON.stringify({ ...datos, vigenteDesde: hoyLocalIso() }),
  });
}
