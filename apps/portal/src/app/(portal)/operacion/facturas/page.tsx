import { PantallaFacturas } from "@/components/facturas/pantalla-facturas";

// Server component delgado (mismo patron que /operacion/ventas).
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ sucursal?: string }>;
}) {
  const { sucursal } = await searchParams;
  return <PantallaFacturas sucursal={sucursal ?? null} />;
}
