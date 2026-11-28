import { PantallaInformacionProduccion } from "@/components/informacion-produccion/pantalla-informacion-produccion";

// Producción → Información de Producción. `key`: cambiar la sucursal del selector global
// vuelve a montar la pantalla, como Inventario de PT con Recargas.
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ sucursal?: string }>;
}) {
  const { sucursal } = await searchParams;
  return <PantallaInformacionProduccion key={sucursal ?? ""} sucursal={sucursal ?? null} />;
}
