import { PantallaInventarioVendedor } from "@/components/inventario-vendedor/pantalla-inventario-vendedor";

// Producción → Inventario por vendedor. `key`: cambiar la sucursal del selector global
// vuelve a montar la pantalla, como Corte.
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ sucursal?: string }>;
}) {
  const { sucursal } = await searchParams;
  return <PantallaInventarioVendedor key={sucursal ?? ""} sucursal={sucursal ?? null} />;
}
