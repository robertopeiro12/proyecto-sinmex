"use client";

import { formatearPesos, leerPiezas, type Captura, type FilaProducto } from "@/lib/ventas";

/** La captura de productos (T-17): cantidad y promoción por presentación, con subtotal en vivo. */
export function TablaProductosVenta({
  filas,
  captura,
  onCambio,
  disabled,
}: {
  filas: FilaProducto[];
  captura: Captura;
  onCambio: (presentacionId: string, campo: "cantidad" | "promocion", valor: string) => void;
  disabled: boolean;
}) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-muted-foreground">
          <th className="py-1 font-medium">Producto</th>
          <th className="py-1 font-medium">Precio</th>
          <th className="py-1 font-medium">Cantidad</th>
          <th className="py-1 font-medium">Promoción</th>
          <th className="py-1 text-right font-medium">Subtotal</th>
        </tr>
      </thead>
      <tbody>
        {filas.map((f) => {
          const nombre = `${f.producto} ${f.volumen}`;
          const sinPrecio = f.precioCentavos === null;
          const piezas = leerPiezas(captura[f.presentacionId]?.cantidad ?? "") ?? 0;
          return (
            <tr key={f.presentacionId} className="border-t">
              <td className="py-1.5">{nombre}</td>
              <td className="py-1.5">
                {sinPrecio ? (
                  <span className="text-muted-foreground">sin precio en la lista</span>
                ) : (
                  formatearPesos(f.precioCentavos ?? 0)
                )}
              </td>
              <td className="py-1.5">
                <input
                  aria-label={`Cantidad de ${nombre}`}
                  type="number"
                  min={0}
                  step="any"
                  inputMode="numeric"
                  disabled={f.deshabilitada || disabled}
                  value={captura[f.presentacionId]?.cantidad ?? ""}
                  onChange={(e) => onCambio(f.presentacionId, "cantidad", e.target.value)}
                  className="w-24 rounded-md border px-2 py-1"
                />
              </td>
              <td className="py-1.5">
                <input
                  aria-label={`Promoción de ${nombre}`}
                  type="number"
                  min={0}
                  step="any"
                  inputMode="numeric"
                  disabled={f.deshabilitada || disabled}
                  value={captura[f.presentacionId]?.promocion ?? ""}
                  onChange={(e) => onCambio(f.presentacionId, "promocion", e.target.value)}
                  className="w-24 rounded-md border px-2 py-1"
                />
              </td>
              <td className="py-1.5 text-right">
                {f.deshabilitada || sinPrecio
                  ? "—"
                  : formatearPesos(piezas * (f.precioCentavos ?? 0))}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
