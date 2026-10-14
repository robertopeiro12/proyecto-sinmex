import { PantallaReporteVentas } from "@/components/reporte-ventas/pantalla-reporte-ventas";

// `key`: cambiar la sucursal del selector global vuelve a montar la pantalla
// (filtros y resultados limpios), como /informacion/reportes/kilometraje.
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ sucursal?: string }>;
}) {
  const { sucursal } = await searchParams;
  return <PantallaReporteVentas key={sucursal ?? ""} sucursal={sucursal ?? null} />;
}
