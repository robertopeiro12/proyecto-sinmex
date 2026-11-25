import { PantallaProcesos } from "@/components/procesos/pantalla-procesos";

// Operación → Procesos. `key`: cambiar la sucursal del selector global vuelve a montar la
// pantalla (cliente, captura y listas limpias), como Registro de Operación. `pestana`,
// `cliente` y `nota` llegan de las redirecciones de Registrar venta, Ventas, Facturas y
// Cobranza y del botón Cobrar de Cuentas por Cobrar.
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ sucursal?: string; pestana?: string; cliente?: string; nota?: string }>;
}) {
  const { sucursal, pestana, cliente, nota } = await searchParams;
  return (
    <PantallaProcesos
      key={`${sucursal ?? ""}|${cliente ?? ""}|${nota ?? ""}`}
      sucursal={sucursal ?? null}
      pestanaInicial={pestana ?? null}
      clienteInicial={cliente ?? null}
      notaInicial={nota ?? null}
    />
  );
}
