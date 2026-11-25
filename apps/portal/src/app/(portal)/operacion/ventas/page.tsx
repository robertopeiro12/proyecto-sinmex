import { redirect } from "next/navigation";

// Procesos › Notas reemplazó a esta pantalla: la dirección vieja lleva ahí y conserva la sucursal.
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ sucursal?: string }>;
}) {
  const { sucursal } = await searchParams;
  const params = new URLSearchParams({ pestana: "notas" });
  if (sucursal) params.set("sucursal", sucursal);
  redirect(`/operacion/procesos?${params.toString()}`);
}
