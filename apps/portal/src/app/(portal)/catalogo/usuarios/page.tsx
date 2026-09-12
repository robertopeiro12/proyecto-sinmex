import { PantallaUsuarios } from "@/components/usuarios/pantalla-usuarios";

// Next 15: `searchParams` es una promesa (mismo patron que T-11/T-12).
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ sucursal?: string }>;
}) {
  const { sucursal } = await searchParams;
  return <PantallaUsuarios sucursal={sucursal ?? null} />;
}
