"use client";

import { Campo, Lista } from "@/components/ui/campo";
import { REPARTIDOR_OFICINA, type Repartidor } from "@/lib/ventas";

/** Vendedores de la sucursal y, si aplica, "Oficina" al final (venta de mostrador). */
export function SelectorRepartidor({
  repartidores,
  valor,
  onCambio,
  disabled,
  conOficina,
}: {
  repartidores: Repartidor[];
  valor: string;
  onCambio: (valor: string) => void;
  disabled: boolean;
  conOficina: boolean;
}) {
  return (
    <Campo id="repartidor" etiqueta="Repartidor" className="w-64">
      <Lista disabled={disabled} value={valor} onChange={(e) => onCambio(e.target.value)}>
        <option value="">Elige…</option>
        {repartidores.map((r) => (
          <option key={r.id} value={r.id}>
            {r.nombre}
          </option>
        ))}
        {conOficina && <option value={REPARTIDOR_OFICINA}>Oficina</option>}
      </Lista>
    </Campo>
  );
}
