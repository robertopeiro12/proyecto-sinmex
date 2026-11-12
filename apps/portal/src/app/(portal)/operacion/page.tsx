import { PantallaDashboard } from "@/components/dashboard/pantalla-dashboard";

// Dashboard: lo de hoy de los vendedores en ruta (spec §5.2).
// `key`: cambiar la sucursal del selector global vuelve a montar la pantalla
// (resultados y renglón abierto limpios), como el Flujo diario.
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ sucursal?: string }>;
}) {
  const { sucursal } = await searchParams;
  return <PantallaDashboard key={sucursal ?? ""} sucursal={sucursal ?? null} />;
}
