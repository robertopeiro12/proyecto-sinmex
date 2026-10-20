"use client";

import { Entrada } from "@/components/ui/campo";
import { Monto } from "@/components/ui/monto";
import { CajaTabla, Tabla, Td, Th } from "@/components/ui/tabla";
import { leerPiezas, type Captura, type FilaProducto } from "@/lib/ventas";

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
    <CajaTabla>
      <Tabla densidad="compacta">
        <thead>
          <tr>
            <Th>Producto</Th>
            <Th alinear="derecha">Precio</Th>
            <Th>Cantidad</Th>
            <Th>Promoción</Th>
            <Th alinear="derecha">Subtotal</Th>
          </tr>
        </thead>
        <tbody>
          {filas.map((f) => {
            const nombre = `${f.producto} ${f.volumen}`;
            const sinPrecio = f.precioCentavos === null;
            const piezas = leerPiezas(captura[f.presentacionId]?.cantidad ?? "") ?? 0;
            return (
              <tr key={f.presentacionId}>
                <Td>{nombre}</Td>
                <Td alinear="derecha" className="whitespace-nowrap">
                  {sinPrecio ? (
                    <span className="text-muted-foreground">sin precio en la lista</span>
                  ) : (
                    <Monto centavos={f.precioCentavos ?? 0} />
                  )}
                </Td>
                <Td>
                  <Entrada
                    aria-label={`Cantidad de ${nombre}`}
                    type="number"
                    min={0}
                    step="any"
                    inputMode="numeric"
                    disabled={f.deshabilitada || disabled}
                    value={captura[f.presentacionId]?.cantidad ?? ""}
                    onChange={(e) => onCambio(f.presentacionId, "cantidad", e.target.value)}
                    className="h-8 w-24"
                  />
                </Td>
                <Td>
                  <Entrada
                    aria-label={`Promoción de ${nombre}`}
                    type="number"
                    min={0}
                    step="any"
                    inputMode="numeric"
                    disabled={f.deshabilitada || disabled}
                    value={captura[f.presentacionId]?.promocion ?? ""}
                    onChange={(e) => onCambio(f.presentacionId, "promocion", e.target.value)}
                    className="h-8 w-24"
                  />
                </Td>
                <Td alinear="derecha" className="whitespace-nowrap">
                  {f.deshabilitada || sinPrecio ? "—" : <Monto centavos={piezas * (f.precioCentavos ?? 0)} />}
                </Td>
              </tr>
            );
          })}
        </tbody>
      </Tabla>
    </CajaTabla>
  );
}
