import { PantallaFlujoDiario } from "@/components/flujo-diario/pantalla-flujo-diario";

// Flujo diario (reemplaza al Reporte de Ventas de T-49; la dirección se conserva).
// `key`: cambiar la sucursal del selector global vuelve a montar la pantalla
// (filtros y resultados limpios), como /informacion/reportes/kilometraje.
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ sucursal?: string }>;
}) {
  const { sucursal } = await searchParams;
  return <PantallaFlujoDiario key={sucursal ?? ""} sucursal={sucursal ?? null} />;
}
