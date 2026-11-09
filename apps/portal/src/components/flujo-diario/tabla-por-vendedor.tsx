"use client";

import { Fragment } from "react";
import { Monto } from "@/components/ui/monto";
import { CajaTabla, Fila, FilaGrupo, FilaTotal, FilaVacia, Tabla, Td, TdMonto, Th } from "@/components/ui/tabla";
import {
  agruparPorSucursal,
  etiquetaRutaAsignada,
  obtenerDetalleVendedor,
  type FlujoDiario,
  type ResumenVendedorDia,
  type Totales,
} from "@/lib/flujo-diario";
import { formatearFecha, formatearPesos, plural } from "@/lib/formato";
import { DetalleVendedor, type PestanaDetalleVendedor } from "./detalle-vendedor";
import { FilaDetalle } from "./fila-detalle";
import { BotonNumero, BotonRenglon, BotonVer, formatearPiezas, Pronto } from "./piezas";
import { useDetalleAbierto } from "./use-detalle-abierto";

const COLUMNAS = 12;
const claveDe = (f: ResumenVendedorDia) => `${f.fecha}|${f.vendedorId}`;

/**
 * "Por vendedor" (spec §5.3): un renglón por vendedor y día. Con varias sucursales, un bloque
 * por sucursal con su subtotal y un total general. El detalle se abre bajo el renglón.
 */
export function TablaPorVendedor({
  flujo,
  nombreSucursal,
}: {
  flujo: FlujoDiario;
  nombreSucursal: (codigo: string) => string;
}) {
  const { abierto, estado, alternar, abrirEn, cambiarPestana } = useDetalleAbierto<
    Awaited<ReturnType<typeof obtenerDetalleVendedor>>,
    PestanaDetalleVendedor
  >((clave) => {
    const fila = flujo.porVendedor.find((f) => claveDe(f) === clave)!;
    // La sucursal del renglón: así funciona también con "Todas".
    return obtenerDetalleVendedor({ fecha: fila.fecha, vendedor: fila.vendedorId, sucursal: fila.sucursalCodigo });
  }, "venta");

  const grupos = agruparPorSucursal(flujo.porVendedor);
  const varias = flujo.bloques.length > 1;

  function renglon(f: ResumenVendedorDia) {
    const clave = claveDe(f);
    const estaAbierto = abierto?.clave === clave;
    const abrir = (p: PestanaDetalleVendedor) => abrirEn(clave, p);
    return (
      <Fragment key={clave}>
        <Fila interactiva onClick={() => alternar(clave)} className={estaAbierto ? "bg-menu" : undefined}>
          <Td className="whitespace-nowrap">{formatearFecha(f.fecha)}</Td>
          <Td>
            <BotonRenglon abierto={estaAbierto} onClick={() => alternar(clave)}>
              {f.vendedor}
            </BotonRenglon>
          </Td>
          <Td className={f.clientesEnRuta === 0 ? "text-muted-foreground" : undefined}>
            {etiquetaRutaAsignada(f.clientesEnRuta)}
          </Td>
          <Td alinear="derecha">
            <BotonNumero cero={f.piezas === 0} etiqueta={`Venta general de ${f.vendedor}`} onClick={() => abrir("venta")}>
              {formatearPiezas(f.piezas)}
            </BotonNumero>
          </Td>
          <TdMonto centavos={f.montoCentavos} className={f.montoCentavos === 0 ? "text-muted-foreground" : undefined} />
          <Td alinear="derecha" className="whitespace-nowrap">
            <BotonNumero cero={f.cobranzaCentavos === 0} etiqueta={`Cobranza de ${f.vendedor}`} onClick={() => abrir("cobranza")}>
              {formatearPesos(f.cobranzaCentavos)}
            </BotonNumero>
          </Td>
          <Td alinear="derecha" className="whitespace-nowrap">
            <BotonNumero cero={f.gastoCentavos === 0} etiqueta={`Gastos de ${f.vendedor}`} onClick={() => abrir("gastos")}>
              {formatearPesos(f.gastoCentavos)}
            </BotonNumero>
          </Td>
          <TdMonto centavos={f.tesoreriaCentavos} className="font-bold" />
          <Td alinear="centro">
            <BotonVer etiqueta={`Notas de venta de ${f.vendedor}`} onClick={() => abrir("notas")} />
          </Td>
          <Td alinear="centro">
            <BotonVer etiqueta={`Ruta de ${f.vendedor}`} onClick={() => abrir("visitas")} />
          </Td>
          <Td alinear="centro">
            <BotonVer etiqueta={`Mermas, cambios y promociones de ${f.vendedor}`} onClick={() => abrir("mermas")} />
          </Td>
          <Td alinear="centro">
            <Pronto />
          </Td>
        </Fila>
        {estaAbierto && (
          <FilaDetalle columnas={COLUMNAS} estado={estado}>
            {(detalle) => (
              <DetalleVendedor
                key={abierto.vez}
                detalle={detalle}
                modo="flujo"
                pestanaInicial={abierto.pestana}
                onCambioPestana={cambiarPestana}
              />
            )}
          </FilaDetalle>
        )}
      </Fragment>
    );
  }

  return (
    <CajaTabla>
      <Tabla aria-label="Por vendedor" className="min-w-[82rem] table-fixed">
        <colgroup>
          <col className="w-24" />
          <col />
          <col className="w-40" />
          <col className="w-24" />
          <col className="w-28" />
          <col className="w-30" />
          <col className="w-28" />
          <col className="w-28" />
          <col className="w-20" />
          <col className="w-16" />
          <col className="w-22" />
          <col className="w-22" />
        </colgroup>
        <thead>
          <tr>
            <Th>Fecha</Th>
            <Th>Vendedor</Th>
            <Th>Ruta asignada</Th>
            <Th alinear="derecha" className="whitespace-normal">Venta general</Th>
            <Th alinear="derecha">Monto</Th>
            <Th alinear="derecha">Cobranza</Th>
            <Th alinear="derecha">Gasto</Th>
            <Th alinear="derecha">Tesorería</Th>
            <Th alinear="centro" className="whitespace-normal">Notas de venta</Th>
            <Th alinear="centro">Ruta</Th>
            <Th alinear="centro" className="whitespace-normal">Mermas, cambios, promos</Th>
            <Th alinear="centro">Inventario</Th>
          </tr>
        </thead>
        <tbody>
          {flujo.porVendedor.length === 0 && (
            <FilaVacia columnas={COLUMNAS}>Ningún vendedor tuvo ruta ni movimientos en esas fechas.</FilaVacia>
          )}
          {varias
            ? grupos.map((g) => {
                const bloque = flujo.bloques.find((b) => b.sucursalCodigo === g.sucursalCodigo);
                const nombre = nombreSucursal(g.sucursalCodigo);
                return (
                  <Fragment key={g.sucursalCodigo}>
                    <FilaGrupo columnas={COLUMNAS}>{nombre}</FilaGrupo>
                    {g.filas.map(renglon)}
                    {bloque && <RenglonTotal texto={`Subtotal ${nombre}`} totales={bloque.porVendedor} />}
                  </Fragment>
                );
              })
            : flujo.porVendedor.map(renglon)}
          {flujo.porVendedor.length > 0 && <RenglonTotal texto="Total" totales={flujo.totalPorVendedor} />}
        </tbody>
      </Tabla>
    </CajaTabla>
  );
}

function RenglonTotal({ texto, totales }: { texto: string; totales: Totales }) {
  return (
    <FilaTotal>
      <Td colSpan={3}>{`${texto} · ${plural(totales.rutas, "ruta", "rutas")}`}</Td>
      <Td alinear="derecha">{formatearPiezas(totales.piezas)}</Td>
      <TdMonto centavos={totales.montoCentavos} />
      <TdMonto centavos={totales.cobranzaCentavos} />
      <TdMonto centavos={totales.gastoCentavos} />
      <Td alinear="derecha" className="whitespace-nowrap">
        <Monto centavos={totales.tesoreriaCentavos} />
      </Td>
      <Td colSpan={4} />
    </FilaTotal>
  );
}
