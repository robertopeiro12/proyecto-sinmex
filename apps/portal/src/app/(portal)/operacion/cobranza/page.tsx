import { PantallaCobranza } from "@/components/cobranza/pantalla-cobranza";

// Server component delgado (mismo patron que /operacion/facturas). `cliente` y
// `nota` llegan del boton Cobrar de Cuentas por Cobrar (T-22).
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ sucursal?: string; cliente?: string; nota?: string }>;
}) {
  const { sucursal, cliente, nota } = await searchParams;
  return (
    <PantallaCobranza
      key={`${sucursal ?? ""}|${cliente ?? ""}|${nota ?? ""}`}
      sucursal={sucursal ?? null}
      clienteInicial={cliente ?? null}
      notaInicial={nota ?? null}
    />
  );
}
