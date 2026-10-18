import { PantallaTesoreria } from "@/components/tesoreria/pantalla-tesoreria";

// `key`: cambiar la sucursal del selector global vuelve a montar la pantalla, como
// /operacion/reporte-de-ventas. `vista` elige la pestaña (enlace que se puede mandar).
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ sucursal?: string; vista?: string }>;
}) {
  const { sucursal, vista } = await searchParams;
  return <PantallaTesoreria key={sucursal ?? ""} sucursal={sucursal ?? null} vistaInicial={vista ?? null} />;
}
