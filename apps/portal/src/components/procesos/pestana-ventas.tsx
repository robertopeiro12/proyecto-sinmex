"use client";

import { PantallaRegistrarVenta } from "@/components/ventas/pantalla-registrar-venta";
import type { ClienteResumen } from "@/lib/clientes";

/**
 * Procesos → Ventas (spec D1): el formulario de *Registrar venta* de siempre con el
 * cliente de arriba. Mismo permiso (`venta.registrar`, lo filtra la pantalla) y mismas
 * reglas. `key` del cliente (Review Focus 5): otro cliente monta un formulario nuevo,
 * así que nada de lo capturado para el anterior viaja en la venta.
 */
export function PestanaVentas({
  sucursal,
  cliente,
  onVerEnNotas,
  onSucio,
  onRegistrada,
}: {
  sucursal: string;
  cliente: ClienteResumen | null;
  onVerEnNotas: (folio: string) => void;
  onSucio: (sucio: boolean) => void;
  onRegistrada: () => void;
}) {
  if (!cliente) {
    return (
      <p className="rounded-[10px] border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
        Elige un cliente arriba.
      </p>
    );
  }
  return (
    <PantallaRegistrarVenta
      key={cliente.id}
      sucursal={sucursal}
      clienteFijo={cliente}
      onVerEnNotas={onVerEnNotas}
      onSucio={onSucio}
      onRegistrada={onRegistrada}
    />
  );
}
