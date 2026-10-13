import { PantallaRutaDiaria } from "@/components/rutas/pantalla-ruta-diaria";

// Server component delgado (mismo patrón que /operacion/cobranza).
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ sucursal?: string }>;
}) {
  const { sucursal } = await searchParams;
  return <PantallaRutaDiaria sucursal={sucursal ?? null} />;
}
