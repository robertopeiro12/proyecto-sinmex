import { PantallaPrecios } from "@/components/precios/pantalla-precios";

// En Next 15 `searchParams` es una promesa. Igual que Vehiculos (D2 de su
// spec), esta pantalla SI lee el filtro de sucursal.
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ sucursal?: string }>;
}) {
  const { sucursal } = await searchParams;
  return <PantallaPrecios sucursal={sucursal ?? null} />;
}
