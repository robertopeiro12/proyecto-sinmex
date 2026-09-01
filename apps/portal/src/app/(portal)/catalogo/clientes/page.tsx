import { PantallaClientes } from "@/components/clientes/pantalla-clientes";
import type { TipoFiltro } from "@/lib/clientes";

function normalizarTipo(crudo: string | undefined): TipoFiltro {
  return crudo === "cliente" || crudo === "prospecto" ? crudo : "todos";
}

// En Next 15 `searchParams` es una promesa (mismo patron que la pagina de
// Vehiculos, T-11): server component delgado que solo lee los filtros.
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ sucursal?: string; tipo?: string }>;
}) {
  const { sucursal, tipo } = await searchParams;
  return <PantallaClientes sucursal={sucursal ?? null} tipo={normalizarTipo(tipo)} />;
}
