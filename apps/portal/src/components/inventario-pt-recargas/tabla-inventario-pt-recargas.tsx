"use client";

import { Fragment, type ReactNode } from "react";
import { InicialConMarca, Opcional, SEPARADOR } from "@/components/inventario-pt/tabla-inventario-pt";
import { CajaTabla, Fila, FilaGrupo, FilaTotal, FilaVacia, Tabla, Td, Th } from "@/components/ui/tabla";
import type { VistaPt } from "@/lib/inventario-pt";
import { gruposPtRecargas, type RenglonPtRecargas, type TotalesPtRecargas } from "@/lib/inventario-pt-recargas";

export const TITULO = "Inventario de PT con Recargas";

const COLUMNAS = 6;

/** Las Recargas ≠ 0 se pican para ver a quién; un 0 queda como texto. */
function Picable({ valor, onPicar }: { valor: number; onPicar?: () => void }) {
  if (valor === 0 || !onPicar) return <>{valor}</>;
  return (
    <button
      type="button"
      onClick={onPicar}
      aria-label={`Ver a quién: ${valor} ${valor === 1 ? "pieza" : "piezas"} de recarga`}
      className="text-info underline decoration-dotted underline-offset-4 outline-none hover:decoration-solid focus-visible:decoration-solid"
    >
      {valor}
    </button>
  );
}

/** Las 5 celdas de números de un renglón o de un total, en el orden de la fórmula del cliente. */
function Celdas({ r, inicial, onPicar }: { r: TotalesPtRecargas; inicial?: ReactNode; onPicar?: () => void }) {
  return (
    <>
      <Td alinear="derecha">{inicial ?? <Opcional valor={r.inicial} />}</Td>
      <Td alinear="derecha">
        <Picable valor={r.recargas} onPicar={onPicar} />
      </Td>
      <Td alinear="derecha">{r.envios}</Td>
      <Td alinear="derecha">{r.entradas}</Td>
      <Td alinear="derecha" className={`${SEPARADOR} font-semibold`}>
        <Opcional valor={r.actual} />
      </Td>
    </>
  );
}

/**
 * La tabla de hoy: Producto · Inicial · Recargas · Envíos · Entradas/Compras · Actual (fórmula del
 * tío, 2026-11-25). Por presentación, agrupada por tamaño con su total; por producto, un renglón
 * por producto. Recargas ≠ 0 se pica para ver a quién (D5).
 */
export function TablaInventarioPtRecargas({
  renglones,
  vista,
  onDetalle,
}: {
  renglones: RenglonPtRecargas[];
  vista: VistaPt;
  onDetalle: (r: RenglonPtRecargas) => void;
}) {
  function renglon(r: RenglonPtRecargas) {
    return (
      <Fila key={r.presentacionId ?? r.productoId} className="align-middle">
        <Td className="truncate" title={r.producto}>{r.producto}</Td>
        <Celdas r={r} inicial={<InicialConMarca r={r} />} onPicar={() => onDetalle(r)} />
      </Fila>
    );
  }

  const cuerpo =
    renglones.length === 0 ? (
      <FilaVacia columnas={COLUMNAS}>No hay productos.</FilaVacia>
    ) : vista === "producto" ? (
      renglones.map(renglon)
    ) : (
      gruposPtRecargas(renglones).map((g) => (
        <Fragment key={g.tamano}>
          <FilaGrupo columnas={COLUMNAS}>{g.tamano}</FilaGrupo>
          {g.renglones.map(renglon)}
          <FilaTotal>
            <Td>{`Total ${g.tamano}`}</Td>
            <Celdas r={g.totales} />
          </FilaTotal>
        </Fragment>
      ))
    );

  const th = "whitespace-normal align-bottom";
  return (
    <CajaTabla>
      <Tabla aria-label={TITULO} className="table-fixed">
        <colgroup>
          <col className="w-[20%]" />
          {Array.from({ length: COLUMNAS - 1 }, (_, n) => (
            <col key={n} />
          ))}
        </colgroup>
        <thead>
          <tr>
            <Th className={th}>Producto</Th>
            <Th alinear="derecha" className={th}>Inicial</Th>
            <Th alinear="derecha" className={th}>Recargas</Th>
            <Th alinear="derecha" className={th}>Envíos</Th>
            <Th alinear="derecha" className={th}>Entradas / Compras</Th>
            <Th alinear="derecha" className={`${th} ${SEPARADOR}`}>Actual</Th>
          </tr>
        </thead>
        <tbody>{cuerpo}</tbody>
      </Tabla>
    </CajaTabla>
  );
}
