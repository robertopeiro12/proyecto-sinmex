/**
 * El color de cada sucursal (UI Etapa 1, spec §2.1): la única parte llamativa del
 * portal, para saber dónde estás sin leer. Los valores viven en `globals.css`
 * (`--suc-tj`, `--suc-mx`, `--suc-todas`, con su versión oscura).
 *
 * Una sucursal nueva (Ensenada) usa la tinta hasta que se le asigne un color: se
 * agrega aquí Y su variable en `globals.css`.
 */
const COLOR_POR_CODIGO: Record<string, string> = {
  TJ: "var(--suc-tj)",
  MX: "var(--suc-mx)",
};

export const COLOR_TODAS = "var(--suc-todas)";

/** Mismo valor reservado que usa el backend en alcance-sucursal.ts. */
const TODAS = "todas";

const esTodas = (codigo: string | null): codigo is null =>
  codigo === null || codigo === "" || codigo.toLowerCase() === TODAS;

/** `null` (o "todas") = Todas las sucursales. */
export function colorDeSucursal(codigo: string | null): string {
  if (esTodas(codigo)) return COLOR_TODAS;
  return COLOR_POR_CODIGO[codigo.toUpperCase()] ?? COLOR_TODAS;
}

/** Lo que dice la pastilla del menú escondido: "TJ", "MX" o "Todas". */
export function siglasDeSucursal(codigo: string | null): string {
  return esTodas(codigo) ? "Todas" : codigo.toUpperCase();
}
