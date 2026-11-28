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
  leerDetalleInformacion,
  textoRango,
  type DetalleInformacionProduccion,
  type RenglonInformacion,
} from "@/lib/informacion-produccion";

/** Las capturas (Entradas/Compras) que suman el renglón en el rango consultado, con su total. */
export function VentanaDetalleInformacion({
  renglon,
  desde,
  hasta,
  sucursal,
  alCerrar,
}: {
  renglon: RenglonInformacion;
  desde: string;
  hasta: string;
  sucursal: string;
  alCerrar: () => void;
}) {
  const [datos, setDatos] = useState<DetalleInformacionProduccion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const todas = sucursal === "todas";

  useEffect(() => {
    let vigente = true;
    leerDetalleInformacion(cualDe(renglon), desde, hasta, sucursal).then(
      (r) => vigente && setDatos(r),
      (err: unknown) => vigente && setError(mensajeDe(err, "No se pudieron cargar las capturas.")),
    );
    return () => {
      vigente = false;
    };
  }, [renglon, desde, hasta, sucursal]);

  const total = datos?.detalle.reduce((t, d) => t + d.piezas, 0) ?? 0;
  const columnas = todas ? 6 : 5;
  const rango = textoRango(desde, hasta);

  return (
    <Ventana abierta alCerrar={alCerrar} ancho="ancho" titulo={`${nombreDe(renglon)} · ${rango}`}>
      {error && <Aviso tono="error">{error}</Aviso>}
      {!datos && !error && <p className="text-sm text-muted-foreground">Cargando…</p>}
      {datos && (
        <CajaTabla>
          <Tabla aria-label="Capturas">
            <thead>
              <tr>
                <Th>Día</Th>
                {todas && <Th>Sucursal</Th>}
                <Th>Origen</Th>
                <Th>Capturó</Th>
                <Th alinear="derecha">Piezas</Th>
                <Th>Comentario</Th>
              </tr>
            </thead>
            <tbody>
              {datos.detalle.length === 0 && <FilaVacia columnas={columnas}>Sin capturas en esas fechas.</FilaVacia>}
              {datos.detalle.map((d, i) => (
                <Fila key={`${d.fecha}|${d.hora}|${d.sucursal}|${i}`}>
                  <Td>{`${formatearDiaCorto(d.fecha)} ${d.hora}`}</Td>
                  {todas && <Td>{d.sucursal}</Td>}
                  <Td>{d.origen === "produccion" ? "Producción" : "Compra"}</Td>
                  <Td>{d.capturo}</Td>
                  <Td alinear="derecha">{d.piezas}</Td>
                  <Td>{d.comentario ?? ""}</Td>
                </Fila>
              ))}
            </tbody>
            {datos.detalle.length > 0 && (
              <tfoot>
                <FilaTotal>
                  <Td>Total</Td>
                  {todas && <Td />}
                  <Td />
                  <Td />
                  <Td alinear="derecha">{total}</Td>
                  <Td />
                </FilaTotal>
              </tfoot>
            )}
          </Tabla>
        </CajaTabla>
      )}
    </Ventana>
  );
}
