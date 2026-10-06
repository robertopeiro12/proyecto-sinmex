import { PantallaRegistrarVenta } from "@/components/ventas/pantalla-registrar-venta";

// Server component delgado (mismo patron que /catalogo/clientes): solo lee el
// filtro de sucursal; en Next 15 `searchParams` es una promesa.
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ sucursal?: string }>;
}) {
  const { sucursal } = await searchParams;
  return <PantallaRegistrarVenta sucursal={sucursal ?? null} />;
}
