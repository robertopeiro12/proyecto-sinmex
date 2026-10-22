import { PantallaRetorno } from "@/components/produccion/pantalla-retorno";

// Server component delgado (mismo patrón que /produccion/produccion-del-dia).
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ sucursal?: string }>;
}) {
  const { sucursal } = await searchParams;
  return <PantallaRetorno sucursal={sucursal ?? null} />;
}
