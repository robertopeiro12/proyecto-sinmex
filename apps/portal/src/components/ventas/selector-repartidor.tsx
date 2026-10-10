"use client";

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
    <div className="flex flex-col gap-1.5">
      <label htmlFor="repartidor" className="text-sm font-medium">
        Repartidor
      </label>
      <select
        id="repartidor"
        disabled={disabled}
        value={valor}
        onChange={(e) => onCambio(e.target.value)}
        className="w-64 rounded-md border px-3 py-2 text-sm"
      >
        <option value="">Elige…</option>
        {repartidores.map((r) => (
          <option key={r.id} value={r.id}>
            {r.nombre}
          </option>
        ))}
        {conOficina && <option value={REPARTIDOR_OFICINA}>Oficina</option>}
      </select>
    </div>
  );
}
