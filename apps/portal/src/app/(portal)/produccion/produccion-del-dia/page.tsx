import { redirect } from "next/navigation";

// Producción del día se volvió la pestaña Entradas del Registro de Operación (spec
// 2026-11-24, D17): la dirección vieja lleva ahí y conserva la sucursal elegida.
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ sucursal?: string }>;
}) {
  const { sucursal } = await searchParams;
  const params = new URLSearchParams({ pestana: "entrada" });
  if (sucursal) params.set("sucursal", sucursal);
  redirect(`/produccion/registro-operacion?${params.toString()}`);
}
