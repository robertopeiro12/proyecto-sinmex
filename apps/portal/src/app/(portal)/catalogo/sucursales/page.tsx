import { PantallaSucursales } from "@/components/sucursales/pantalla-sucursales";

// En Next 15 `searchParams` es una promesa. La pagina es un server component
// que solo lee el filtro y lo baja; toda la interaccion vive en el cliente.
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ sucursal?: string }>;
}) {
  const { sucursal } = await searchParams;
  return <PantallaSucursales sucursal={sucursal ?? null} />;
}
