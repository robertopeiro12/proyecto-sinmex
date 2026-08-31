"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { TipoFiltro } from "@/lib/clientes";

/**
 * Mismo patron que SelectorSucursal (T-09): lee/escribe el query param, sin
 * estado propio. A diferencia de aquel, este filtro es local a la pantalla
 * de Clientes (no vive en el sidebar) — el resto de catalogos no tiene
 * columna "tipo".
 */
export function FiltroTipo({ valor }: { valor: TipoFiltro }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function cambiar(nuevo: TipoFiltro) {
    const nuevos = new URLSearchParams(params.toString());
    if (nuevo === "todos") {
      // "todos" es el default: se quita el param en vez de escribirlo,
      // mismo criterio que SelectorSucursal con "todas".
      nuevos.delete("tipo");
    } else {
      nuevos.set("tipo", nuevo);
    }
    const query = nuevos.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  }

  return (
    <select
      aria-label="Filtrar por tipo"
      value={valor}
      onChange={(e) => cambiar(e.target.value as TipoFiltro)}
      className="rounded-md border px-2 py-1 text-sm"
    >
      <option value="todos">Todos</option>
      <option value="cliente">Clientes</option>
      <option value="prospecto">Prospectos</option>
    </select>
  );
}
