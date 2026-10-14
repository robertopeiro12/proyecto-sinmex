import { apiFetch } from "./api";
import type { DefinicionExcel, FilaExcel } from "./excel/definicion";
import { formatearFecha } from "./reportes";

/*
 * Reporte de Clientes nuevos (T-51). Misma forma que
 * apps/backend/src/modules/estadisticas/reglas-clientes-nuevos.ts.
 */

export interface ClienteNuevo {
  id: string;
  /** `AAAA-MM-DD` de Tijuana. */
  fechaAlta: string;
  nombre: string;
  sucursalCodigo: string;
  tipoNegocio: string | null;
  listaPrecio: string | null;
  telefono: string;
  encargado: string | null;
  /** `null` = no se sabe (clientes anteriores a T-51). */
  usuario: string | null;
  dadoDeBaja: boolean;
}

export interface ReporteClientesNuevos {
  desde: string;
  hasta: string;
  clientes: ClienteNuevo[];
  total: number;
}

export function obtenerReporteClientesNuevos(f: {
  desde: string;
  hasta: string;
  sucursal: string | null;
}): Promise<ReporteClientesNuevos> {
  const q = new URLSearchParams({ desde: f.desde, hasta: f.hasta });
  if (f.sucursal) q.set("sucursal", f.sucursal);
  return apiFetch<ReporteClientesNuevos>(`/reportes/clientes-nuevos?${q.toString()}`);
}

export function nombreConBaja(c: { nombre: string; dadoDeBaja: boolean }): string {
  return c.dadoDeBaja ? `${c.nombre} (dado de baja)` : c.nombre;
}

export function textoTotalClientes(n: number): string {
  return n === 1 ? "1 cliente nuevo" : `${n} clientes nuevos`;
}

const oGuion = (v: string | null): string => v ?? "—";

/** Lo consultado como hoja de Excel. `filtros` son los APLICADOS. */
export function definicionExcelClientesNuevos(
  r: ReporteClientesNuevos,
  filtros: { sucursal: string },
): DefinicionExcel {
  const filas: FilaExcel[] = r.clientes.map((c) => ({
    celdas: [
      c.fechaAlta,
      nombreConBaja(c),
      c.sucursalCodigo,
      oGuion(c.tipoNegocio),
      oGuion(c.listaPrecio),
      c.telefono,
      oGuion(c.encargado),
      oGuion(c.usuario),
    ],
  }));
  filas.push({ tipo: "total", celdas: [`Total: ${textoTotalClientes(r.total)}`, null, null, null, null, null, null, null] });

  return {
    titulo: "Clientes nuevos",
    filtros: [
      ["Rango", `${formatearFecha(r.desde)} a ${formatearFecha(r.hasta)}`],
      ["Sucursal", filtros.sucursal],
    ],
    columnas: [
      { encabezado: "Fecha de alta", tipo: "fecha", ancho: 14 },
      { encabezado: "Cliente", tipo: "texto", ancho: 36 },
      { encabezado: "Sucursal", tipo: "texto", ancho: 10 },
      { encabezado: "Tipo de negocio", tipo: "texto", ancho: 20 },
      { encabezado: "Lista de precios", tipo: "texto", ancho: 18 },
      { encabezado: "Teléfono", tipo: "texto", ancho: 14 },
      { encabezado: "Encargado", tipo: "texto", ancho: 22 },
      { encabezado: "Usuario", tipo: "texto", ancho: 22 },
    ],
    filas,
    nombreArchivo: `clientes-nuevos_${r.desde}_a_${r.hasta}`,
  };
}
