import { PantallaVehiculos } from "@/components/vehiculos/pantalla-vehiculos";

// En Next 15 `searchParams` es una promesa. La pagina es un server component
// que solo lee el filtro y lo baja; toda la interaccion vive en el cliente.
// A diferencia de la de Productos, esta SI lee el filtro (D2).
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ sucursal?: string }>;
}) {
  const { sucursal } = await searchParams;
  return <PantallaVehiculos sucursal={sucursal ?? null} />;
}
