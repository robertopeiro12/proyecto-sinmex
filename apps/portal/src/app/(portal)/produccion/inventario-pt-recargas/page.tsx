import { PantallaInventarioPtRecargas } from "@/components/inventario-pt-recargas/pantalla-inventario-pt-recargas";

// Producción → Inventario de PT con Recargas. `key`: cambiar la sucursal del selector global
// vuelve a montar la pantalla, como Inventario de PT con Ventas.
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ sucursal?: string }>;
}) {
  const { sucursal } = await searchParams;
  return <PantallaInventarioPtRecargas key={sucursal ?? ""} sucursal={sucursal ?? null} />;
}
