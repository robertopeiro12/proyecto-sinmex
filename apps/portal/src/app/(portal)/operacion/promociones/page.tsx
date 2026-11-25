import { redirect } from "next/navigation";

// Promociones pasó a Catálogo (es configuración, como Listas de Precios): la dirección vieja lleva ahí y conserva la
// sucursal.
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ sucursal?: string }>;
}) {
  const { sucursal } = await searchParams;
  redirect(sucursal ? `/catalogo/promociones?${new URLSearchParams({ sucursal }).toString()}` : "/catalogo/promociones");
}
