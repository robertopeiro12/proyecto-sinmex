import { redirect } from "next/navigation";

// Retorno se volvió parte del Corte (spec 2026-11-12, D1/D13): la dirección vieja lleva
// al Corte y conserva la sucursal elegida.
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ sucursal?: string }>;
}) {
  const { sucursal } = await searchParams;
  redirect(sucursal ? `/produccion/corte?${new URLSearchParams({ sucursal }).toString()}` : "/produccion/corte");
}
