import { redirect } from "next/navigation";

// Procesos › Notas reemplazó a Cobranza. `cliente` y `nota` (del botón Cobrar de Cuentas por
// Cobrar, T-22) pasan tal cual; se conserva la sucursal.
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ sucursal?: string; cliente?: string; nota?: string }>;
}) {
  const { sucursal, cliente, nota } = await searchParams;
  const params = new URLSearchParams({ pestana: "notas" });
  if (cliente) params.set("cliente", cliente);
  if (nota) params.set("nota", nota);
  if (sucursal) params.set("sucursal", sucursal);
  redirect(`/operacion/procesos?${params.toString()}`);
}
