import { ListaReportes } from "@/components/reportes/lista-reportes";

// Server component delgado (mismo patron que /operacion/peticiones).
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ sucursal?: string }>;
}) {
  const { sucursal } = await searchParams;
  return <ListaReportes sucursal={sucursal ?? null} />;
}
