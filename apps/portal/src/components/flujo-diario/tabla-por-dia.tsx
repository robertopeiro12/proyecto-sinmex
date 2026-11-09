"use client";

import { Fragment } from "react";
import { CajaTabla, Fila, FilaGrupo, FilaTotal, FilaVacia, Tabla, Td, TdMonto, Th } from "@/components/ui/tabla";
import {
  agruparPorSucursal,
  obtenerDetalleDia,
  type DetalleDia as DatosDetalleDia,
  type FlujoDiario,
  type ResumenDia,
  type Totales,
} from "@/lib/flujo-diario";
import { formatearFecha, formatearPesos } from "@/lib/formato";
import { DetalleDia, type PestanaDetalleDia } from "./detalle-dia";
import { FilaDetalle } from "./fila-detalle";
import { Barra, BotonNumero, BotonRenglon, BotonVer, formatearPiezas, Pronto } from "./piezas";
import { useDetalleAbierto } from "./use-detalle-abierto";

const COLUMNAS = 11;
const claveDe = (d: ResumenDia) => `${d.fecha}|${d.sucursalCodigo}`;

/**
 * "Por día" (spec §5.3): un renglón por día (por sucursal con "Todas"), de toda la sucursal:
 * no se filtra por vendedor y la cobranza suma también la de la oficina.
 */
export function TablaPorDia({
  flujo,
  nombreSucursal,
}: {
  /** Consultado sin vendedor. */
  flujo: FlujoDiario;
  nombreSucursal: (codigo: string) => string;
}) {
  const { abierto, estado, alternar, abrirEn, cambiarPestana } = useDetalleAbierto<DatosDetalleDia, PestanaDetalleDia>((clave) => {
    const dia = flujo.porDia.find((d) => claveDe(d) === clave)!;
    return obtenerDetalleDia({ fecha: dia.fecha, sucursal: dia.sucursalCodigo, vendedor: null });
  }, "ventas");

  const grupos = agruparPorSucursal(flujo.porDia);
  const varias = flujo.bloques.length > 1;

  function renglon(d: ResumenDia) {
    const clave = claveDe(d);
    const estaAbierto = abierto?.clave === clave;
    const t = d.totales;
    const fecha = formatearFecha(d.fecha);
    const abrir = (p: PestanaDetalleDia) => abrirEn(clave, p);
    return (
      <Fragment key={clave}>
        <Fila interactiva onClick={() => alternar(clave)} className={estaAbierto ? "bg-menu" : undefined}>
          <Td className="whitespace-nowrap">
            <BotonRenglon abierto={estaAbierto} onClick={() => alternar(clave)}>
              {fecha}
            </BotonRenglon>
          </Td>
          <Td alinear="centro">{t.rutas}</Td>
          <Td alinear="derecha">
            <BotonNumero cero={t.piezas === 0} etiqueta={`Ventas del ${fecha}`} onClick={() => abrir("ventas")}>
              {formatearPiezas(t.piezas)}
            </BotonNumero>
          </Td>
          <TdMonto centavos={t.montoCentavos} className={t.montoCentavos === 0 ? "text-muted-foreground" : undefined} />
          <Td alinear="derecha" className="whitespace-nowrap">
            <BotonNumero cero={t.cobranzaCentavos === 0} etiqueta={`Cobranza del ${fecha}`} onClick={() => abrir("cobranza")}>
              {formatearPesos(t.cobranzaCentavos)}
            </BotonNumero>
          </Td>
          <Td alinear="derecha" className="whitespace-nowrap">
            <BotonNumero cero={t.gastoCentavos === 0} etiqueta={`Gastos del ${fecha}`} onClick={() => abrir("gastos")}>
              {formatearPesos(t.gastoCentavos)}
            </BotonNumero>
          </Td>
          <TdMonto centavos={t.tesoreriaCentavos} className="font-bold" />
          <Td alinear="centro">
            <BotonVer etiqueta={`Mermas del ${fecha}`} onClick={() => abrir("mermas")} />
          </Td>
          <Td alinear="centro">
            <BotonVer etiqueta={`Promociones del ${fecha}`} onClick={() => abrir("promociones")} />
          </Td>
          <Td>
            <VisitasRuta totales={t} onClick={() => abrir("visitas")} />
          </Td>
          <Td alinear="centro">
            <Pronto />
          </Td>
        </Fila>
        {estaAbierto && (
          <FilaDetalle columnas={COLUMNAS} estado={estado}>
            {(detalle) => (
              <DetalleDia
                key={abierto.vez}
                detalle={detalle}
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
      <Tabla aria-label="Por día" className="min-w-[72rem] table-fixed">
        <colgroup>
          <col className="w-32" />
          <col className="w-16" />
          <col className="w-24" />
          <col className="w-28" />
          <col className="w-30" />
          <col className="w-28" />
          <col className="w-28" />
          <col className="w-20" />
          <col className="w-24" />
          <col />
          <col className="w-22" />
        </colgroup>
        <thead>
          <tr>
            <Th>Fecha</Th>
            <Th alinear="centro">Rutas</Th>
            <Th alinear="derecha" className="whitespace-normal">Ventas (piezas)</Th>
            <Th alinear="derecha">Monto</Th>
            <Th alinear="derecha">Cobranza</Th>
            <Th alinear="derecha">Gastos</Th>
            <Th alinear="derecha">Tesorería</Th>
            <Th alinear="centro">Mermas</Th>
            <Th alinear="centro">Promociones</Th>
            <Th>Visitas / ruta</Th>
            <Th alinear="centro">Inventario</Th>
          </tr>
        </thead>
        <tbody>
          {flujo.porDia.length === 0 && <FilaVacia columnas={COLUMNAS}>No hubo movimientos en esas fechas.</FilaVacia>}
          {varias
            ? grupos.map((g) => {
                const bloque = flujo.bloques.find((b) => b.sucursalCodigo === g.sucursalCodigo);
                const nombre = nombreSucursal(g.sucursalCodigo);
                return (
                  <Fragment key={g.sucursalCodigo}>
                    <FilaGrupo columnas={COLUMNAS}>{nombre}</FilaGrupo>
                    {g.filas.map(renglon)}
                    {bloque && <RenglonTotal texto={`Subtotal ${nombre}`} totales={bloque.porDia} />}
                  </Fragment>
                );
              })
            : flujo.porDia.map(renglon)}
          {flujo.porDia.length > 0 && <RenglonTotal texto="Total" totales={flujo.totalPorDia} />}
        </tbody>
      </Tabla>
    </CajaTabla>
  );
}

/** "26 / 39" con su barrita; se pica para ver las visitas del día. */
function VisitasRuta({ totales, onClick }: { totales: Totales; onClick?: () => void }) {
  const texto = `${totales.atendidosEnRuta} / ${totales.clientesEnRuta}`;
  return (
    <div className="flex flex-col gap-1">
      {onClick ? (
        <button
          type="button"
          aria-label={`Visitas: ${texto}`}
          onClick={(e) => {
            e.stopPropagation();
            onClick();
          }}
          className="self-start rounded outline-none hover:underline focus-visible:ring-2 focus-visible:ring-sucursal"
        >
          {texto}
        </button>
      ) : (
        <span>{texto}</span>
      )}
      <Barra valor={totales.atendidosEnRuta} maximo={totales.clientesEnRuta} className="w-12" />
    </div>
  );
}

function RenglonTotal({ texto, totales }: { texto: string; totales: Totales }) {
  return (
    <FilaTotal>
      <Td>{texto}</Td>
      <Td alinear="centro">{totales.rutas}</Td>
      <Td alinear="derecha">{formatearPiezas(totales.piezas)}</Td>
      <TdMonto centavos={totales.montoCentavos} />
      <TdMonto centavos={totales.cobranzaCentavos} />
      <TdMonto centavos={totales.gastoCentavos} />
      <TdMonto centavos={totales.tesoreriaCentavos} />
      <Td colSpan={2} />
      <Td>
        <VisitasRuta totales={totales} />
      </Td>
      <Td />
    </FilaTotal>
  );
}
