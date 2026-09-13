import { PantallaVendedores } from "@/components/vendedores/pantalla-vendedores";

// En Next 15 `searchParams` es una promesa. La pagina es un server component
// que solo lee el filtro y lo baja; toda la interaccion vive en el cliente.
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ sucursal?: string }>;
}) {
  const { sucursal } = await searchParams;
  return <PantallaVendedores sucursal={sucursal ?? null} />;
}
