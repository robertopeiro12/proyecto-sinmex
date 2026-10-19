import { PantallaGastos } from "@/components/gastos/pantalla-gastos";

// T-30/T-31 (D10). `key`: cambiar la sucursal del selector global vuelve a montar la
// pantalla, como /finanzas/tesoreria y /operacion/reporte-de-ventas.
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ sucursal?: string }>;
}) {
  const { sucursal } = await searchParams;
  return <PantallaGastos key={sucursal ?? ""} sucursal={sucursal ?? null} />;
}
