import { PantallaPromociones } from "@/components/promociones/pantalla-promociones";

// Server component delgado (mismo patrón que /operacion/ruta-diaria).
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ sucursal?: string }>;
}) {
  const { sucursal } = await searchParams;
  return <PantallaPromociones sucursal={sucursal ?? null} />;
}
