import { apiFetch } from "./api";
import { leerPiezas } from "./produccion";
import type { Producto } from "./productos";

// Copia normativa de `CortesDelDia`, `CorteVendedor` y `LineaCortePantalla` en
// apps/backend/src/modules/produccion/cortes.service.ts, y de `TotalesCorte` en
// reglas-corte.ts. El portal no importa del backend: un cambio de forma en un lado
// exige el equivalente en el otro. Spec:
// docs/superpowers/specs/2026-11-12-corte-de-mercancia-design.md (§5).

export type EstadoCorte = "sin_corte" | "hecho" | "con_faltante";

/** Un vendedor en la lista del día (`GET /cortes`). */
export interface FilaCorte {
  vendedor: { id: string; nombre: string };
  sucursal: { id: string; codigo: string };
  piezasCargadas: number;
  estado: EstadoCorte;
  /** No tiene ninguna carga aceptada ese día (vendió con una carga sin aceptar o sin capturar). */
  sinCarga: boolean;
  /** Suma de faltantes > 0; `null` si el corte no está hecho. */
  piezasFaltantes: number | null;
  hechoEn: string | null;
}

export interface CortesDelDia {
  fecha: string;
  /** Hoy de Tijuana según el servidor. */
  hoy: string;
  /** Ordenados por sucursal y nombre. */
  vendedores: FilaCorte[];
}

/** Una presentación del corte. */
export interface LineaCorte {
  presentacionId: string;
  /** Producto + tamaño ("Horchata 1 L"). */
  nombre: string;
  cargadas: number;
  vendidas: number;
  regaladas: number;
  /** cargadas − vendidas − regaladas, sin recortar: negativo = vendió más de lo cargado. */
  deberiaRegresar: number;
  /** Lo contado y guardado (0 si no hay). */
  buenas: number;
  merma: number;
  /** `null` si el corte no está hecho; < 0 = sobrante. */
  faltante: number | null;
}

export interface TotalesCorte {
  cargadas: number;
  vendidas: number;
  regaladas: number;
  deberiaRegresar: number;
  buenas: number;
  merma: number;
  /** Suma de los faltantes > 0 (un sobrante no compensa lo que falta de otra); `null` sin corte. */
  faltante: number | null;
}

/** `GET` y `PUT /cortes/vendedor`. */
export interface CorteVendedor {
  fecha: string;
  hoy: string;
  vendedor: { id: string; nombre: string };
  sucursal: { id: string; codigo: string };
  lineas: LineaCorte[];
  totales: TotalesCorte;
  /** Cuándo y quién (nombre del usuario) lo hizo; `null` = sin corte. */
  hecho: { en: string; por: string } | null;
}

export interface ConteoCorte {
  presentacionId: string;
  buenas: number;
  merma: number;
}

/** `sucursal`: código (`TJ`) o `null` = todas las que alcance el usuario. */
export function leerCortesDelDia(fecha: string, sucursal: string | null): Promise<CortesDelDia> {
  const params = new URLSearchParams({ fecha, sucursal: sucursal ?? "todas" });
  return apiFetch<CortesDelDia>(`/cortes?${params.toString()}`);
}

export function leerCorteVendedor(fecha: string, vendedor: string): Promise<CorteVendedor> {
  const params = new URLSearchParams({ fecha, vendedor });
  return apiFetch<CorteVendedor>(`/cortes/vendedor?${params.toString()}`);
}

/**
 * Reemplaza el conteo del día con TODAS las líneas (0/0 da de baja la presentación) y
 * deja el corte hecho, aunque no venga ninguna pieza.
 */
export function guardarCorteVendedor(datos: {
  fecha: string;
  vendedor: string;
  lineas: ConteoCorte[];
}): Promise<CorteVendedor> {
  return apiFetch<CorteVendedor>("/cortes/vendedor", { method: "PUT", body: JSON.stringify(datos) });
}

// ── Reglas de la pantalla (puras) ──────────────────────────────────────────────

/** La pastilla de estado de la lista: "Sin corte" gris, "Corte hecho", "Faltan N" rojo. */
export function etiquetaEstadoCorte(
  fila: Pick<FilaCorte, "estado" | "piezasFaltantes">,
): { texto: string; tono: "neutro" | "exito" | "error" } {
  if (fila.estado === "sin_corte") return { texto: "Sin corte", tono: "neutro" };
  if (fila.estado === "con_faltante") return { texto: `Faltan ${fila.piezasFaltantes ?? 0}`, tono: "error" };
  return { texto: "Corte hecho", tono: "exito" };
}

/** El estado de un corte ya leído, con la misma regla que la lista del servidor. */
export function estadoDeCorte(corte: Pick<CorteVendedor, "hecho" | "totales">): Pick<FilaCorte, "estado" | "piezasFaltantes"> {
  if (!corte.hecho) return { estado: "sin_corte", piezasFaltantes: null };
  const faltan = corte.totales.faltante ?? 0;
  return { estado: faltan > 0 ? "con_faltante" : "hecho", piezasFaltantes: faltan };
}

/** Lo guardado como texto del campo: vacío si no hay (nunca el teórico prellenado). */
export const textoConteo = (piezas: number) => (piezas > 0 ? String(piezas) : "");

/** Lo escrito en los campos, por presentación. */
export type BorradorCorte = Record<string, { buenas: string; merma: string }>;

export function borradorDeCorte(lineas: readonly LineaCorte[]): BorradorCorte {
  return Object.fromEntries(
    lineas.map((l) => [l.presentacionId, { buenas: textoConteo(l.buenas), merma: textoConteo(l.merma) }]),
  );
}

/** Una línea vacía para una presentación agregada a mano (sin movimiento ese día). */
export function lineaAgregada(presentacionId: string, nombre: string): LineaCorte {
  return {
    presentacionId,
    nombre,
    cargadas: 0,
    vendidas: 0,
    regaladas: 0,
    deberiaRegresar: 0,
    buenas: 0,
    merma: 0,
    faltante: null,
  };
}

export interface FilaVistaCorte {
  linea: LineaCorte;
  /** Lo leído de los campos; `null` = no es un entero válido. Vacío = 0. */
  buenas: number | null;
  merma: number | null;
  /** Debería − buenas; `null` mientras no se muestra (corte sin hacer y sin captura) o con buenas inválidas. */
  faltante: number | null;
}

export interface VistaCorte {
  filas: FilaVistaCorte[];
  totales: TotalesCorte;
  hayInvalidas: boolean;
  /** Algo de lo escrito difiere de lo guardado. */
  cambios: boolean;
  /** Buenas + merma escritas = 0 (el vendedor no regresó nada). */
  sinPiezas: boolean;
}

/**
 * La tabla del corte con lo que va escribiendo el almacenista. El faltante se muestra si
 * el corte ya está hecho o si se está capturando (hay cambios): es lo que quedará al
 * guardar. Antes de eso, lo no capturado no es un faltante (D9). Los totales de faltante
 * suman solo los positivos, como el servidor.
 */
export function vistaCorte(lineas: readonly LineaCorte[], borrador: BorradorCorte, hecho: boolean): VistaCorte {
  const leidas = lineas.map((l) => ({
    linea: l,
    buenas: leerPiezas(borrador[l.presentacionId]?.buenas ?? ""),
    merma: leerPiezas(borrador[l.presentacionId]?.merma ?? ""),
  }));
  const hayInvalidas = leidas.some((f) => f.buenas === null || f.merma === null);
  const cambios = leidas.some((f) => f.buenas !== f.linea.buenas || f.merma !== f.linea.merma);
  const mostrarFaltante = hecho || cambios;
  const filas = leidas.map((f) => ({
    ...f,
    faltante: mostrarFaltante && f.buenas !== null ? f.linea.deberiaRegresar - f.buenas : null,
  }));
  const suma = (valor: (f: FilaVistaCorte) => number) => filas.reduce((t, f) => t + valor(f), 0);
  return {
    filas,
    totales: {
      cargadas: suma((f) => f.linea.cargadas),
      vendidas: suma((f) => f.linea.vendidas),
      regaladas: suma((f) => f.linea.regaladas),
      deberiaRegresar: suma((f) => f.linea.deberiaRegresar),
      buenas: suma((f) => f.buenas ?? 0),
      merma: suma((f) => f.merma ?? 0),
      faltante: mostrarFaltante ? suma((f) => Math.max(f.faltante ?? 0, 0)) : null,
    },
    hayInvalidas,
    cambios,
    sinPiezas: suma((f) => (f.buenas ?? 0) + (f.merma ?? 0)) === 0,
  };
}

/** Lo que se manda al guardar: todas las líneas de la tabla, vacío = 0. */
export function conteosDe(vista: VistaCorte): ConteoCorte[] {
  return vista.filas.map((f) => ({ presentacionId: f.linea.presentacionId, buenas: f.buenas ?? 0, merma: f.merma ?? 0 }));
}

/** Presentaciones vivas (de productos activos) que todavía no están en la tabla, por nombre. */
export function presentacionesParaAgregar(
  productos: readonly Producto[],
  enTabla: readonly { presentacionId: string }[],
): { id: string; nombre: string }[] {
  const ya = new Set(enTabla.map((l) => l.presentacionId));
  return productos
    .filter((p) => p.activo)
    .flatMap((p) => p.presentaciones.map((pr) => ({ id: pr.id, nombre: `${p.nombre} ${pr.volumen}` })))
    .filter((pr) => !ya.has(pr.id))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
}
