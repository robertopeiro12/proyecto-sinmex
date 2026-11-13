import { PantallaCorte } from "@/components/produccion/pantalla-corte";

// Producción → Corte (absorbe a Retorno). `key`: cambiar la sucursal del selector global
// vuelve a montar la pantalla (lista y corte abierto limpios), como el Dashboard.
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ sucursal?: string }>;
}) {
  const { sucursal } = await searchParams;
  return <PantallaCorte key={sucursal ?? ""} sucursal={sucursal ?? null} />;
}
