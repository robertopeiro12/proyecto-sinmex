import { PantallaProduccionDia } from "@/components/produccion/pantalla-produccion-dia";

// Server component delgado (mismo patrón que /produccion/recarga): lee el selector
// global de sucursal y lo baja; toda la interacción vive en el cliente.
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ sucursal?: string }>;
}) {
  const { sucursal } = await searchParams;
  return <PantallaProduccionDia sucursal={sucursal ?? null} />;
}
