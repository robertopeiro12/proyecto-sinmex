"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { listarSucursales, type Sucursal } from "@/lib/sucursales";

/** Mismo valor reservado que usa el backend en alcance-sucursal.ts. */
const TODAS = "todas";

export function SelectorSucursal() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);

  useEffect(() => {
    // Se piden SIN filtro a proposito: el selector necesita saber todo lo que
    // el usuario puede elegir, no lo que esta viendo ahora mismo. El backend
    // ya lo acota a lo que le toca.
    listarSucursales()
      .then(setSucursales)
      .catch(() => setSucursales([]));
  }, []);

  const activas = sucursales.filter((s) => s.activa);
  const seleccion = params.get("sucursal") ?? TODAS;

  // Un usuario atado a una sucursal recibe exactamente una, asi que no hay
  // nada que elegir y se muestra como texto. La distincion entre "General" y
  // "atado" no necesita logica propia aqui: sale de lo que devuelve la API.
  if (activas.length <= 1) {
    return (
      <span className="text-muted-foreground">{activas[0]?.nombre ?? "—"}</span>
    );
  }

  function cambiar(valor: string) {
    const nuevos = new URLSearchParams(params.toString());
    if (valor === TODAS) {
      // "todas" es el default, asi que se quita el param en vez de escribirlo:
      // deja la URL limpia y hace que ?sucursal= no aparezca nunca vacio.
      nuevos.delete("sucursal");
    } else {
      nuevos.set("sucursal", valor);
    }
    const query = nuevos.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  }

  return (
    <select
      aria-label="Filtrar por sucursal"
      value={seleccion}
      onChange={(e) => cambiar(e.target.value)}
      className="rounded-md border px-2 py-1 text-sm"
    >
      <option value={TODAS}>Todas las sucursales</option>
      {activas.map((s) => (
        <option key={s.id} value={s.codigo}>
          {s.nombre}
        </option>
      ))}
    </select>
  );
}
