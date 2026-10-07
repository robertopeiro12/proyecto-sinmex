import { PantallaCobranza } from "@/components/cobranza/pantalla-cobranza";

// Server component delgado (mismo patron que /operacion/facturas).
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ sucursal?: string }>;
}) {
  const { sucursal } = await searchParams;
  return <PantallaCobranza sucursal={sucursal ?? null} />;
}
