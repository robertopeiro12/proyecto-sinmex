"use client";

import { useEffect, useState } from "react";
import { cualDe } from "@/components/inventario-pt/ventanas-detalle";
import { nombreDe } from "@/components/inventario-pt/tabla-inventario-pt";
import { Aviso } from "@/components/ui/aviso";
import { CajaTabla, Fila, FilaTotal, FilaVacia, Tabla, Td, Th } from "@/components/ui/tabla";
import { Ventana } from "@/components/ui/ventana";
import { mensajeDe } from "@/lib/api";
import { formatearDiaCorto } from "@/lib/formato";
import { leerDetallePtRecargas, type DetallePtRecargas, type RenglonPtRecargas } from "@/lib/inventario-pt-recargas";

/**
 * D5: a quién se le recargó: vendedor, n.º de carga y piezas aceptadas, con su total. Por
 * producto, suman las presentaciones del producto (lo hace el servidor).
 */
export function VentanaAQuien({
  renglon,
  fecha,
  sucursal,
  alCerrar,
}: {
  renglon: RenglonPtRecargas;
  fecha: string;
  sucursal: string;
  alCerrar: () => void;
}) {
  const [datos, setDatos] = useState<DetallePtRecargas | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vigente = true;
    leerDetallePtRecargas(cualDe(renglon), sucursal).then(
      (r) => vigente && setDatos(r),
      (err: unknown) => vigente && setError(mensajeDe(err, "No se pudieron cargar las recargas.")),
    );
    return () => {
      vigente = false;
    };
  }, [renglon, sucursal]);

  const total = datos?.detalle.reduce((t, d) => t + d.piezas, 0) ?? 0;

  return (
    <Ventana
      abierta
      alCerrar={alCerrar}
      ancho="ancho"
      titulo={`Recargas · ${nombreDe(renglon)} · ${formatearDiaCorto(fecha)}`}
    >
      {error && <Aviso tono="error">{error}</Aviso>}
      {!datos && !error && <p className="text-sm text-muted-foreground">Cargando…</p>}
      {datos && (
        <CajaTabla>
          <Tabla aria-label="A quién">
            <thead>
              <tr>
                <Th>Vendedor</Th>
                <Th alinear="derecha">Carga</Th>
                <Th alinear="derecha">Piezas</Th>
              </tr>
            </thead>
            <tbody>
              {datos.detalle.length === 0 && (
                <FilaVacia columnas={3}>Sin recargas aceptadas hoy.</FilaVacia>
              )}
              {datos.detalle.map((d, i) => (
                <Fila key={`${d.quien}|${d.carga}|${i}`}>
                  <Td>{d.quien}</Td>
                  <Td alinear="derecha">{d.carga}</Td>
                  <Td alinear="derecha">{d.piezas}</Td>
                </Fila>
              ))}
            </tbody>
            {datos.detalle.length > 0 && (
              <tfoot>
                <FilaTotal>
                  <Td>Total</Td>
                  <Td />
                  <Td alinear="derecha">{total}</Td>
                </FilaTotal>
              </tfoot>
            )}
          </Tabla>
        </CajaTabla>
      )}
    </Ventana>
  );
}
