import { PantallaKilometraje } from "@/components/reportes/pantalla-kilometraje";

// `key`: cambiar la sucursal del selector global vuelve a montar la pantalla
// (filtros y resultados limpios, sin mostrar datos de la sucursal anterior).
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ sucursal?: string }>;
}) {
  const { sucursal } = await searchParams;
  return <PantallaKilometraje key={sucursal ?? ""} sucursal={sucursal ?? null} />;
}
