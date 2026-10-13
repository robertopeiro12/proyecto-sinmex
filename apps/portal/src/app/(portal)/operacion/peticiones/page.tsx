import { PantallaPeticiones } from "@/components/peticiones/pantalla-peticiones";

// Server component delgado (mismo patron que /operacion/cobranza).
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ sucursal?: string }>;
}) {
  const { sucursal } = await searchParams;
  return <PantallaPeticiones sucursal={sucursal ?? null} />;
}
