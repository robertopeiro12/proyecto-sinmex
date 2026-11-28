"use client";

import { Fragment } from "react";
import { CajaTabla, Fila, FilaGrupo, FilaTotal, FilaVacia, Tabla, Td, Th } from "@/components/ui/tabla";
import { gruposInformacion, totalInformacion, type RenglonInformacion, type TotalesInformacion } from "@/lib/informacion-produccion";
import type { VistaPt } from "@/lib/inventario-pt";

export const TITULO = "Información de Producción";

const COLUMNAS = 4;

function Celdas({ t }: { t: TotalesInformacion }) {
  return (
    <>
      <Td alinear="derecha">{t.produccion}</Td>
      <Td alinear="derecha">{t.compras}</Td>
      <Td alinear="derecha" className="font-semibold">{t.total}</Td>
    </>
  );
}

/**
 * La tabla del rango: Producto · Producción · Compras · Total. Por presentación, agrupada por
 * tamaño con su total y un Total general; por producto, un renglón por producto. El nombre es un
 * botón que abre las capturas que lo componen.
 */
export function TablaInformacionProduccion({
  renglones,
  vista,
  onDetalle,
}: {
  renglones: RenglonInformacion[];
  vista: VistaPt;
  onDetalle: (r: RenglonInformacion) => void;
}) {
  function renglon(r: RenglonInformacion) {
    return (
      <Fila key={r.presentacionId ?? r.productoId} className="align-middle">
        <Td className="truncate" title={r.producto}>
          <button
            type="button"
            onClick={() => onDetalle(r)}
            className="text-left text-info underline decoration-dotted underline-offset-4 outline-none hover:decoration-solid focus-visible:decoration-solid"
          >
            {r.producto}
          </button>
        </Td>
        <Celdas t={r} />
      </Fila>
    );
  }

  const cuerpo =
    renglones.length === 0 ? (
      <FilaVacia columnas={COLUMNAS}>No hubo entradas en esas fechas.</FilaVacia>
    ) : (
      <>
        {vista === "producto"
          ? renglones.map(renglon)
          : gruposInformacion(renglones).map((g) => (
              <Fragment key={g.tamano}>
                <FilaGrupo columnas={COLUMNAS}>{g.tamano}</FilaGrupo>
                {g.renglones.map(renglon)}
                <FilaTotal>
                  <Td>{`Total ${g.tamano}`}</Td>
                  <Celdas t={g.totales} />
                </FilaTotal>
              </Fragment>
            ))}
        <FilaTotal>
          <Td>Total</Td>
          <Celdas t={totalInformacion(renglones)} />
        </FilaTotal>
      </>
    );

  return (
    <CajaTabla>
      <Tabla aria-label={TITULO} className="table-fixed">
        <colgroup>
          <col className="w-[40%]" />
          <col />
          <col />
          <col />
        </colgroup>
        <thead>
          <tr>
            <Th>Producto</Th>
            <Th alinear="derecha">Producción</Th>
            <Th alinear="derecha">Compras</Th>
            <Th alinear="derecha">Total</Th>
          </tr>
        </thead>
        <tbody>{cuerpo}</tbody>
      </Tabla>
    </CajaTabla>
  );
}
