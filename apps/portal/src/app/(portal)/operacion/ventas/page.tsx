import { PantallaVentas } from "@/components/ventas/pantalla-ventas";

// Server component delgado (mismo patron que /operacion/registrar-venta): solo
// lee el filtro de sucursal; en Next 15 `searchParams` es una promesa.
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ sucursal?: string }>;
}) {
  const { sucursal } = await searchParams;
  return <PantallaVentas sucursal={sucursal ?? null} />;
}
