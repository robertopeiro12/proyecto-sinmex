import { apiFetch } from "./api";
import type { ClienteResumen } from "./clientes";
import { normalizarTexto } from "./ventas";

// Copia normativa de las formas de
// apps/backend/src/modules/rutas/rutas-diarias.service.ts (`RutaDiaria`, `RutaAnterior`) y
// rutas-diarias.repository.ts (`FilaRutaDiaria`). Mismo trato que lib/cobranzas.ts: un cambio
// de forma en un lado exige el equivalente en el otro.

export type OrigenRuta = "oficina" | "vendedor";

export interface FilaRutaDiaria {
  id: string;
  clienteId: string;
  clienteNombre: string;
  orden: number;
  origen: OrigenRuta;
}

export interface RutaDiaria {
  vendedor: { id: string; nombre: string; sucursalCodigo: string };
  fecha: string;
  filas: FilaRutaDiaria[];
}

export interface RutaAnterior {
  /** `null` si el vendedor no tiene ninguna ruta antes de esa fecha. */
  fecha: string | null;
  clientes: string[];
}

/** Una fila de la columna derecha mientras se edita (sin guardar). */
export interface FilaEditable {
  clienteId: string;
  clienteNombre: string;
  origen: OrigenRuta;
}

export function obtenerRutaDiaria(vendedorId: string, fecha: string): Promise<RutaDiaria> {
  return apiFetch<RutaDiaria>(`/rutas/diaria?${new URLSearchParams({ vendedorId, fecha }).toString()}`);
}

export function obtenerRutaAnterior(vendedorId: string, fecha: string): Promise<RutaAnterior> {
  return apiFetch<RutaAnterior>(
    `/rutas/diaria/anterior?${new URLSearchParams({ vendedorId, fecha }).toString()}`,
  );
}

/** Semántica de reemplazo (D14): la lista COMPLETA y ordenada. */
export function guardarRutaDiaria(datos: {
  vendedorId: string;
  fecha: string;
  clientes: string[];
}): Promise<RutaDiaria> {
  return apiFetch<RutaDiaria>("/rutas/diaria", { method: "PUT", body: JSON.stringify(datos) });
}

export function aEditables(ruta: RutaDiaria): FilaEditable[] {
  return ruta.filas.map(({ clienteId, clienteNombre, origen }) => ({ clienteId, clienteNombre, origen }));
}

/** Mueve una fila. Fuera de rango devuelve la MISMA lista (React no repinta). */
export function moverFila(filas: FilaEditable[], desde: number, hasta: number): FilaEditable[] {
  if (desde < 0 || desde >= filas.length || hasta < 0 || hasta >= filas.length) return filas;
  const copia = [...filas];
  const [movida] = copia.splice(desde, 1);
  copia.splice(hasta, 0, movida);
  return copia;
}

/** El portal no puede quitar lo que agregó el vendedor (D2, D14): solo reordenarlo. */
export function quitarFila(filas: FilaEditable[], indice: number): FilaEditable[] {
  if (filas[indice]?.origen !== "oficina") return filas;
  return filas.filter((_, i) => i !== indice);
}

export function agregarFila(filas: FilaEditable[], cliente: { id: string; nombre: string }): FilaEditable[] {
  if (filas.some((f) => f.clienteId === cliente.id)) return filas;
  return [...filas, { clienteId: cliente.id, clienteNombre: cliente.nombre, origen: "oficina" }];
}

/**
 * "Copiar de ayer" (D17): la ruta anterior en su orden, sin guardar. Una fila que
 * ya estaba conserva su origen; un cliente que ya no está en la cartera se omite;
 * las del vendedor que no venían se quedan al final (no se pueden quitar).
 */
export function cargarAnterior(
  filas: FilaEditable[],
  anterior: string[],
  cartera: Pick<ClienteResumen, "id" | "nombre">[],
): FilaEditable[] {
  const actuales = new Map(filas.map((f) => [f.clienteId, f]));
  const nombres = new Map(cartera.map((c) => [c.id, c.nombre]));
  const copiadas: FilaEditable[] = [];
  for (const id of anterior) {
    const actual = actuales.get(id);
    const nombre = nombres.get(id);
    if (actual) copiadas.push(actual);
    else if (nombre !== undefined) copiadas.push({ clienteId: id, clienteNombre: nombre, origen: "oficina" });
  }
  const enCopia = new Set(copiadas.map((f) => f.clienteId));
  return [...copiadas, ...filas.filter((f) => f.origen === "vendedor" && !enCopia.has(f.clienteId))];
}

/** ¿La columna derecha ya no es lo que está guardado? Cuenta el orden. */
export function hayCambios(original: FilaEditable[], actual: FilaEditable[]): boolean {
  return original.length !== actual.length || original.some((f, i) => f.clienteId !== actual[i].clienteId);
}

/** Encabezado "Ruta armada por el vendedor" (D3). */
export function armadaPorElVendedor(filas: FilaEditable[]): boolean {
  return filas.length > 0 && filas.every((f) => f.origen === "vendedor");
}

/** La cartera que se ofrece: lo que no está ya en la ruta, buscando sin acentos. */
export function filtrarCartera(
  cartera: ClienteResumen[],
  enRuta: ReadonlySet<string>,
  busqueda: string,
): ClienteResumen[] {
  const q = normalizarTexto(busqueda.trim());
  return cartera.filter((c) => !enRuta.has(c.id) && (q === "" || normalizarTexto(c.nombre).includes(q)));
}
