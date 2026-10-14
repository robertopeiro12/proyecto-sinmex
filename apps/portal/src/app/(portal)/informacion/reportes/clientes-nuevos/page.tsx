import { PantallaClientesNuevos } from "@/components/reportes/pantalla-clientes-nuevos";

// `key`: cambiar la sucursal del selector global vuelve a montar la pantalla.
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ sucursal?: string }>;
}) {
  const { sucursal } = await searchParams;
  return <PantallaClientesNuevos key={sucursal ?? ""} sucursal={sucursal ?? null} />;
}
