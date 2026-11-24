import { apiFetch } from "./api";
import { claveTamano, compararTamano, fraseFaltan } from "./cortes";
import type { EstadoCorte, TotalesCorte } from "./cortes";

// Copia normativa de `InventarioVendedor`, `LineaInventario` y `RecargaInventario`
// (apps/backend/src/modules/produccion/inventario-vendedor.service.ts y
// cortes.repository.ts, `RecargaDelDia`). El portal no importa del backend: un cambio de
// forma en un lado exige el equivalente en el otro. Spec:
// docs/superpowers/specs/2026-11-24-inventario-por-vendedor-design.md.

/** Una linea de una carga viva del dia, en cualquier estado. */
export interface RecargaInventario {
  cargaId: string;
  numero: number;
  vendedorId: string;
  vendedor: string;
  presentacionId: string;
  nombre: string;
  producto: string;
  volumen: string;
  piezas: number;
  capturo: string;
  /** `HH:MM` de Tijuana. */
  hora: string;
  estado: "pendiente" | "aceptada" | "rechazada";
  motivoRechazo: string | null;
}

/**
 * Una presentacion de la pantalla (los campos del corte). `buenas`, `merma`, `faltante`
 * y `resultadoMerma` son `null` si el corte no esta hecho.
 */
export interface LineaInventario {
  presentacionId: string;
  nombre: string;
  producto: string;
  volumen: string;
  cargadas: number;
  vendidas: number;
  regaladas: number;
  mermaEntregada: number;
  mermaRecibida: number;
  mermaAlmacen: number;
  consumo: number;
  cambiosEntregados: number;
  cambiosRecibidos: number;
  /** Piezas teoricas por regresar, sin recortar. */
  deberiaRegresar: number;
  buenas: number | null;
  faltante: number | null;
  merma: number | null;
  mermaTeorica: number;
  resultadoMerma: number | null;
}

/** `GET /inventario-vendedor`. */
export interface InventarioVendedor {
  fecha: string;
  hoy: string;
  sucursal: { id: string; codigo: string };
  vendedor: { id: string; nombre: string } | null;
  lineas: LineaInventario[];
  totales: TotalesCorte;
  recargas: RecargaInventario[];
  vendedoresSinCorte: number;
  /** Solo con un vendedor; con "todos", `null`. */
  corte: {
    estado: EstadoCorte;
    piezasFaltantes: number | null;
    mermaFaltante: number | null;
  } | null;
}

export function leerInventarioVendedor(
  fecha: string,
  sucursal: string,
  vendedor: string | "todos",
): Promise<InventarioVendedor> {
  const params = new URLSearchParams({ fecha, sucursal, vendedor });
  return apiFetch<InventarioVendedor>(
    `/inventario-vendedor?${params.toString()}`,
  );
}

// ── Reglas de la pantalla (puras) ──────────────────────────────────────────────

export interface TotalesGrupoInventario {
  cargadas: number;
  vendidas: number;
  regaladas: number;
  mermaEntregada: number;
  mermaRecibida: number;
  mermaAlmacen: number;
  consumo: number;
  cambiosEntregados: number;
  cambiosRecibidos: number;
  deberiaRegresar: number;
  mermaTeorica: number;
  /** Los cuatro siguientes: suma con signo de lo que no es `null`; `null` si ninguna linea lo tiene. */
  buenas: number | null;
  merma: number | null;
  faltante: number | null;
  resultadoMerma: number | null;
}

export interface GrupoInventario {
  /** Volumen de la primera linea. */
  tamano: string;
  lineas: LineaInventario[];
  totales: TotalesGrupoInventario;
}

function sumaOpcional(
  lineas: readonly LineaInventario[],
  valor: (l: LineaInventario) => number | null,
): number | null {
  const v = lineas.map(valor).filter((x): x is number => x !== null);
  return v.length === 0 ? null : v.reduce((t, x) => t + x, 0);
}

/** Mismo agrupado y orden que `vistaCorte`: por tamano (`compararTamano`), dentro por producto. */
export function gruposPorTamano(
  lineas: readonly LineaInventario[],
): GrupoInventario[] {
  const porClave = new Map<string, LineaInventario[]>();
  for (const l of lineas) {
    const clave = claveTamano(l.volumen);
    porClave.set(clave, [...(porClave.get(clave) ?? []), l]);
  }
  return [...porClave.values()]
    .map((ls) =>
      [...ls].sort((a, b) => a.producto.localeCompare(b.producto, "es")),
    )
    .sort((a, b) => compararTamano(a[0].volumen, b[0].volumen))
    .map((ls) => {
      const suma = (valor: (l: LineaInventario) => number) =>
        ls.reduce((t, l) => t + valor(l), 0);
      return {
        tamano: ls[0].volumen,
        lineas: ls,
        totales: {
          cargadas: suma((l) => l.cargadas),
          vendidas: suma((l) => l.vendidas),
          regaladas: suma((l) => l.regaladas),
          mermaEntregada: suma((l) => l.mermaEntregada),
          mermaRecibida: suma((l) => l.mermaRecibida),
          mermaAlmacen: suma((l) => l.mermaAlmacen),
          consumo: suma((l) => l.consumo),
          cambiosEntregados: suma((l) => l.cambiosEntregados),
          cambiosRecibidos: suma((l) => l.cambiosRecibidos),
          deberiaRegresar: suma((l) => l.deberiaRegresar),
          mermaTeorica: suma((l) => l.mermaTeorica),
          buenas: sumaOpcional(ls, (l) => l.buenas),
          merma: sumaOpcional(ls, (l) => l.merma),
          faltante: sumaOpcional(ls, (l) => l.faltante),
          resultadoMerma: sumaOpcional(ls, (l) => l.resultadoMerma),
        },
      };
    });
}

/** "Merma registrada en sistema" de una linea. */
export const mermaRegistrada = (l: LineaInventario): number =>
  l.mermaEntregada + l.mermaAlmacen;

export function textoEstadoRecarga(r: Pick<RecargaInventario, "estado">): string {
  if (r.estado === "aceptada") return "Aceptada";
  if (r.estado === "rechazada") return "Rechazada";
  return "Pendiente";
}

/** `"07:29"` → `"7:29 a. m."`; lo que no tiene forma de hora se deja tal cual. */
export function textoHora(hhmm: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) return hhmm;
  const h = Number(m[1]);
  const hora12 = h % 12 === 0 ? 12 : h % 12;
  return `${hora12}:${m[2]} ${h < 12 ? "a. m." : "p. m."}`;
}

/** Faltantes de un dia con la frase de la pastilla del corte; `null` si no hay nada que decir. */
export function textoFaltantesDia(
  f: { piezas: number; merma: number } | null,
): string | null {
  if (!f || (f.piezas === 0 && f.merma === 0)) return null;
  return fraseFaltan(f.piezas, f.merma);
}
