import { PantallaRutaSemanal } from "@/components/rutas-semanales/pantalla-ruta-semanal";

// Server component delgado (mismo patrón que /operacion/ruta-diaria).
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ sucursal?: string }>;
}) {
  const { sucursal } = await searchParams;
  return <PantallaRutaSemanal sucursal={sucursal ?? null} />;
}
