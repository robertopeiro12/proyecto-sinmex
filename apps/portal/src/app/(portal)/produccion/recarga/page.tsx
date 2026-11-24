import { redirect } from "next/navigation";

// Recarga se volvió una pestaña del Registro de Operación: la dirección vieja lleva ahí
// y conserva la sucursal elegida.
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ sucursal?: string }>;
}) {
  const { sucursal } = await searchParams;
  const params = new URLSearchParams({ pestana: "recarga" });
  if (sucursal) params.set("sucursal", sucursal);
  redirect(`/produccion/registro-operacion?${params.toString()}`);
}
