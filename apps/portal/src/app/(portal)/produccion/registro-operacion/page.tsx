import { PantallaRegistroOperacion } from "@/components/registro-operacion/pantalla-registro-operacion";

// Producción → Registro de Operación. `key`: cambiar la sucursal del selector global vuelve
// a montar la pantalla (listas y captura limpias), como Corte.
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ sucursal?: string; pestana?: string }>;
}) {
  const { sucursal, pestana } = await searchParams;
  return <PantallaRegistroOperacion key={sucursal ?? ""} sucursal={sucursal ?? null} pestana={pestana ?? null} />;
}
