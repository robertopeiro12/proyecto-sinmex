import { PantallaRecarga } from "@/components/produccion/pantalla-recarga";

// Server component delgado (mismo patrón que /operacion/ruta-diaria): lee el
// selector global de sucursal y lo baja; toda la interacción vive en el cliente.
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ sucursal?: string }>;
}) {
  const { sucursal } = await searchParams;
  return <PantallaRecarga sucursal={sucursal ?? null} />;
}
