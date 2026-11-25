import { PantallaInventarioPt } from "@/components/inventario-pt/pantalla-inventario-pt";

// Producción → Inventario de PT con Ventas. `key`: cambiar la sucursal del selector global
// vuelve a montar la pantalla, como Corte e Inventario por vendedor.
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ sucursal?: string }>;
}) {
  const { sucursal } = await searchParams;
  return <PantallaInventarioPt key={sucursal ?? ""} sucursal={sucursal ?? null} />;
}
