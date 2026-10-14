import { PantallaCuentasPorCobrar } from "@/components/cuentas-por-cobrar/pantalla-cuentas-por-cobrar";

// `key`: cambiar la sucursal del selector global vuelve a montar la pantalla
// (sin mostrar datos de la sucursal anterior), como /informacion/reportes/kilometraje.
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ sucursal?: string }>;
}) {
  const { sucursal } = await searchParams;
  return <PantallaCuentasPorCobrar key={sucursal ?? ""} sucursal={sucursal ?? null} />;
}
