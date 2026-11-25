"use client";

import { useEffect, useState } from "react";
import { cualDe } from "@/components/inventario-pt/ventanas-detalle";
import { nombreDe } from "@/components/inventario-pt/tabla-inventario-pt";
import { Aviso } from "@/components/ui/aviso";
import { CajaTabla, Fila, FilaTotal, FilaVacia, Tabla, Td, Th } from "@/components/ui/tabla";
import { Ventana } from "@/components/ui/ventana";
import { mensajeDe } from "@/lib/api";
import { formatearDiaCorto } from "@/lib/formato";
import {
  leerDetallePtRecargas,
  textoEstadoCarga,
  type ColumnaDetalleRecargas,
  type DetallePtRecargas,
  type RenglonPtRecargas,
} from "@/lib/inventario-pt-recargas";

/**
 * D5: a quién. Recargas: vendedor, n.º de carga, estado y piezas; Descuentos: el trabajador
 * (los del Registro de Operación) y piezas. Los dos con su total. Por producto, suman las
 * presentaciones del producto (lo hace el servidor).
 */
export function VentanaAQuien({
  renglon,
  columna,
  fecha,
  sucursal,
  alCerrar,
}: {
  renglon: RenglonPtRecargas;
  columna: ColumnaDetalleRecargas;
  fecha: string;
  sucursal: string;
  alCerrar: () => void;
}) {
  const [datos, setDatos] = useState<DetallePtRecargas | null>(null);
  const [error, setError] = useState<string | null>(null);
  const recargas = columna === "recargas";

  useEffect(() => {
    let vigente = true;
    leerDetallePtRecargas(cualDe(renglon), sucursal, columna).then(
      (r) => vigente && setDatos(r),
      (err: unknown) =>
        vigente && setError(mensajeDe(err, recargas ? "No se pudieron cargar las recargas." : "No se pudieron cargar los descuentos.")),
    );
    return () => {
      vigente = false;
    };
  }, [renglon, sucursal, columna, recargas]);

  const columnas = recargas ? 4 : 2;
  const total = datos?.detalle.reduce((t, d) => t + d.piezas, 0) ?? 0;

  return (
    <Ventana
      abierta
      alCerrar={alCerrar}
      ancho="ancho"
      titulo={`${recargas ? "Recargas" : "Descuentos"} · ${nombreDe(renglon)} · ${formatearDiaCorto(fecha)}`}
    >
      {error && <Aviso tono="error">{error}</Aviso>}
      {!datos && !error && <p className="text-sm text-muted-foreground">Cargando…</p>}
      {datos && (
        <CajaTabla>
          <Tabla aria-label="A quién">
            <thead>
              <tr>
                <Th>{recargas ? "Vendedor" : "Trabajador"}</Th>
                {recargas && <Th alinear="derecha">Carga</Th>}
                {recargas && <Th>Estado</Th>}
                <Th alinear="derecha">Piezas</Th>
              </tr>
            </thead>
            <tbody>
              {datos.detalle.length === 0 && (
                <FilaVacia columnas={columnas}>{recargas ? "Sin recargas hoy." : "Sin descuentos hoy."}</FilaVacia>
              )}
              {datos.detalle.map((d, i) => (
                <Fila key={`${d.quien}|${d.carga ?? ""}|${i}`}>
                  <Td>{d.quien}</Td>
                  {recargas && <Td alinear="derecha">{d.carga ?? ""}</Td>}
                  {recargas && <Td>{textoEstadoCarga(d.estado)}</Td>}
                  <Td alinear="derecha">{d.piezas}</Td>
                </Fila>
              ))}
            </tbody>
            {datos.detalle.length > 0 && (
              <tfoot>
                <FilaTotal>
                  <Td>Total</Td>
                  {recargas && <Td />}
                  {recargas && <Td />}
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
