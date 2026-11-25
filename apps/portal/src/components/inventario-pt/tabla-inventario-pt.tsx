"use client";

import { Fragment, type ReactNode } from "react";
import { Etiqueta } from "@/components/ui/etiqueta";
import { CajaTabla, Fila, FilaGrupo, FilaTotal, FilaVacia, Tabla, Td, Th } from "@/components/ui/tabla";
import { gruposPt, textoCambios, type RenglonPt, type TotalesPt, type VistaPt } from "@/lib/inventario-pt";
import { cn } from "@/lib/utils";

export const TITULO = "Inventario de PT con Ventas";

// Línea vertical antes de la Merma acumulada, la misma del Corte.
export const SEPARADOR = "border-l-2 border-l-foreground/20";
const COLUMNAS = 13;
/** La merma acumulada va en ámbar, como en el boceto: es merma, no inventario bueno. */
export const CLASE_MERMA_ACUM = "font-semibold text-warning";

/** El nombre del renglón: producto (Por presentación) o producto (Por producto). */
export function nombreDe(r: Pick<RenglonPt, "producto" | "volumen">): string {
  return r.volumen ? `${r.producto} ${r.volumen}` : r.producto;
}

/** Un número que puede faltar ("Sin inventario inicial"): vacío, nunca 0. */
export function Opcional({ valor }: { valor: number | null }) {
  // Sin texto: la celda queda vacía; el lector de pantalla oye el porqué.
  return valor === null ? <span role="img" aria-label="Sin inventario inicial" title="Sin inventario inicial" /> : <>{valor}</>;
}

/**
 * El Inicial con la marca "Ajustado" (D3) si ese día sale de un ajuste. Solo por
 * presentación: un renglón por producto (`presentacionId` null) mezcla presentaciones
 * ajustadas y sin ajustar, así que no lleva la marca (decisión del controlador).
 */
export function InicialConMarca({ r }: { r: Pick<RenglonPt, "inicial" | "ajustado" | "presentacionId"> }) {
  return (
    <span className="inline-flex flex-col items-end gap-0.5">
      <Opcional valor={r.inicial} />
      {r.ajustado && r.presentacionId !== null && (
        <Etiqueta tono="informacion" className="px-1.5 py-0 text-[11px]">
          Ajustado
        </Etiqueta>
      )}
    </span>
  );
}

/**
 * Encabezados de las columnas del inventario (D1), compartidos por la tabla del día y el
 * historial: lo que cambia es la primera columna (Producto / Día).
 */
export function EncabezadosPt({ primera, corto = false }: { primera: string; corto?: boolean }) {
  const th = "whitespace-normal align-bottom";
  return (
    <tr>
      <Th className={th}>{primera}</Th>
      <Th alinear="derecha" className={th}>Inicial</Th>
      <Th alinear="derecha" className={th}>Ventas</Th>
      <Th alinear="derecha" className={th}>Merma</Th>
      <Th alinear="derecha" className={th}>Consumo</Th>
      <Th alinear="derecha" className={th}>Promo</Th>
      <Th alinear="derecha" className={th}>Descuentos</Th>
      <Th alinear="derecha" className={th}>Cambios</Th>
      <Th alinear="derecha" className={th}>{corto ? "Entradas" : "Entradas / Compras"}</Th>
      <Th alinear="derecha" className={th}>Envíos</Th>
      <Th alinear="derecha" className={th}>Final</Th>
      <Th alinear="derecha" className={`${th} ${SEPARADOR}`}>{corto ? "M. acum." : "Merma acumulada"}</Th>
      <Th alinear="derecha" className={th}>{corto ? "Retiro" : "Retiro de merma"}</Th>
    </tr>
  );
}

/** Las 12 celdas de números de un renglón (o de un total). */
export function CeldasPt({
  r,
  inicial,
  descuentos,
}: {
  r: Omit<TotalesPt, "inicial"> & { inicial: number | null };
  /** El Inicial con su marca "Ajustado"; por omisión el número solo. */
  inicial?: ReactNode;
  /** Los Descuentos que se pueden picar; por omisión el número solo. */
  descuentos?: ReactNode;
}) {
  return (
    <>
      <Td alinear="derecha">{inicial ?? <Opcional valor={r.inicial} />}</Td>
      <Td alinear="derecha">{r.ventas}</Td>
      <Td alinear="derecha">{r.merma}</Td>
      <Td alinear="derecha">{r.consumo}</Td>
      <Td alinear="derecha">{r.promo}</Td>
      <Td alinear="derecha">{descuentos ?? r.descuentos}</Td>
      <Td alinear="derecha">{textoCambios(r.cambios)}</Td>
      <Td alinear="derecha">{r.entradas}</Td>
      <Td alinear="derecha">{r.envios}</Td>
      <Td alinear="derecha" className="font-semibold">
        <Opcional valor={r.final} />
      </Td>
      <Td alinear="derecha" className={cn(SEPARADOR, CLASE_MERMA_ACUM)}>
        <Opcional valor={r.mermaAcumulada} />
      </Td>
      <Td alinear="derecha">{r.retiroMerma}</Td>
    </>
  );
}

/** Ancho de las columnas: Producto proporcional y las 12 de números se reparten el resto (cabe a 1366 px). */
// Medido a 1366 px: "Descuentos" no cabe en una columna pareja y "Retiro de merma" se partía en tres.
const ANCHOS_NUMEROS: Record<number, string> = { 5: "w-[8.5%]", 7: "w-[8.5%]", 10: "w-[9%]", 11: "w-[8%]" };

export function ColumnasPt({ primera = "w-[11%]" }: { primera?: string }) {
  return (
    <colgroup>
      <col className={primera} />
      {Array.from({ length: 12 }, (_, n) => (
        <col key={n} className={ANCHOS_NUMEROS[n]} />
      ))}
    </colgroup>
  );
}

/**
 * La tabla del día (D1): por presentación, agrupada por tamaño con su total; por producto,
 * un renglón por producto sin grupos. El nombre se pica para ver sus días anteriores y los
 * Descuentos (si hay) para ver a quién. Los números vienen del servidor (D6).
 */
export function TablaInventarioPt({
  renglones,
  vista,
  onProducto,
  onDescuentos,
}: {
  renglones: RenglonPt[];
  vista: VistaPt;
  onProducto: (r: RenglonPt) => void;
  onDescuentos: (r: RenglonPt) => void;
}) {
  function renglon(r: RenglonPt) {
    return (
      <Fila key={r.presentacionId ?? r.productoId} className="align-middle">
        <Td>
          <button
            type="button"
            onClick={() => onProducto(r)}
            className="block max-w-full truncate text-left underline-offset-4 outline-none hover:underline focus-visible:underline"
          >
            {r.producto}
          </button>
        </Td>
        <CeldasPt
          r={r}
          inicial={<InicialConMarca r={r} />}
          descuentos={
            r.descuentos !== 0 ? (
              <button
                type="button"
                onClick={() => onDescuentos(r)}
                aria-label={`Ver a quién: ${r.descuentos} ${r.descuentos === 1 ? "pieza" : "piezas"} de descuento`}
                className="text-info underline decoration-dotted underline-offset-4 outline-none hover:decoration-solid focus-visible:decoration-solid"
              >
                {r.descuentos}
              </button>
            ) : undefined
          }
        />
      </Fila>
    );
  }

  const cuerpo =
    renglones.length === 0 ? (
      <FilaVacia columnas={COLUMNAS}>No hay productos.</FilaVacia>
    ) : vista === "producto" ? (
      renglones.map(renglon)
    ) : (
      gruposPt(renglones).map((g) => (
        <Fragment key={g.tamano}>
          <FilaGrupo columnas={COLUMNAS}>{g.tamano}</FilaGrupo>
          {g.renglones.map(renglon)}
          <FilaTotal>
            <Td>{`Total ${g.tamano}`}</Td>
            <CeldasPt r={g.totales} />
          </FilaTotal>
        </Fragment>
      ))
    );

  return (
    <CajaTabla>
      <Tabla aria-label="Inventario de PT" className="table-fixed">
        <ColumnasPt />
        <thead>
          <EncabezadosPt primera="Producto" />
        </thead>
        <tbody>{cuerpo}</tbody>
      </Tabla>
    </CajaTabla>
  );
}
