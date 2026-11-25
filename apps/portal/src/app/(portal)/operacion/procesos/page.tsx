import { PantallaProcesos } from "@/components/procesos/pantalla-procesos";

// Operación → Procesos. `key`: cambiar la sucursal del selector global vuelve a montar la
// pantalla (cliente, captura y listas limpias), como Registro de Operación.
export default async function Page({ searchParams }: { searchParams: Promise<{ sucursal?: string }> }) {
  const { sucursal } = await searchParams;
  return <PantallaProcesos key={sucursal ?? ""} sucursal={sucursal ?? null} />;
}
