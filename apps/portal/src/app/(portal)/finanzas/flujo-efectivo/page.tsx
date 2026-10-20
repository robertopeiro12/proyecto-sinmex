import { PantallaFlujoEfectivo } from "@/components/flujo-efectivo/pantalla-flujo-efectivo";

// `key`: cambiar la sucursal del selector global vuelve a montar la pantalla
// (rango y resultados limpios), como /operacion/reporte-de-ventas.
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ sucursal?: string }>;
}) {
  const { sucursal } = await searchParams;
  return <PantallaFlujoEfectivo key={sucursal ?? ""} sucursal={sucursal ?? null} />;
}
