import { PantallaPromociones } from "@/components/promociones/pantalla-promociones";

// Server component delgado. Vivía en Operación; es configuración (como Precios), así que pasó a Catálogo.
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ sucursal?: string }>;
}) {
  const { sucursal } = await searchParams;
  return <PantallaPromociones sucursal={sucursal ?? null} />;
}
