import { Fragment } from "react";
import { formatearFecha } from "@/lib/reportes";
import { formatearPiezas, nombreRepartidor, type ReporteVentas } from "@/lib/reporte-ventas";
import { ETIQUETA_STATUS, formatearPesos } from "@/lib/ventas";

/*
 * Una sola tabla `table-fixed` para todo el rango (nunca una por día) para que
 * las columnas queden alineadas. Toda celda lleva `px-3` para que ninguna
 * columna quede pegada a otra; los números van a la derecha con `tabular-nums`.
 */
const TH = "sticky top-0 bg-background px-3 py-2 font-medium shadow-[inset_0_-1px_0_var(--border)]";
const TD = "px-3 py-1.5";
const NUM = "text-right tabular-nums";

export function TablaReporteVentas({ reporte }: { reporte: ReporteVentas }) {
  // `w-0 min-w-full`: la caja no aporta su ancho de contenido al `main` (flex-1 sin
  // min-w-0 en el layout compartido); ocupa el ancho disponible y la tabla se desplaza dentro.
  return (
    <div className="max-h-[70vh] w-0 min-w-full overflow-auto rounded-md border">
      <table aria-label="Ventas" className="w-full min-w-[74rem] table-fixed text-sm">
        <colgroup>
          <col className="w-24" />
          <col className="w-32" />
          <col />
          <col className="w-20" />
          <col className="w-32" />
          <col className="w-24" />
          <col className="w-24" />
          <col className="w-16" />
          <col className="w-20" />
          <col className="w-16" />
          <col className="w-36" />
        </colgroup>
        <thead className="text-left">
          <tr>
            <th className={TH}>Fecha</th>
            <th className={TH}>Folio</th>
            <th className={TH}>Cliente</th>
            <th className={TH}># nota</th>
            <th className={TH}>Repartidor</th>
            <th className={TH}>Status</th>
            <th className={TH}>Factura</th>
            <th className={`${TH} ${NUM}`}>Semana</th>
            <th className={`${TH} ${NUM}`}>Cantidad</th>
            <th className={`${TH} ${NUM}`}>Promo</th>
            <th className={`${TH} ${NUM}`}>Monto</th>
          </tr>
        </thead>
        <tbody>
          {reporte.dias.map((dia) => (
            <Fragment key={dia.fecha}>
              {dia.ventas.map((v) => (
                <tr key={v.id} className="border-t">
                  <td className={TD}>{formatearFecha(v.fecha)}</td>
                  <td className={`${TD} font-mono`}>{v.folio}</td>
                  <td className={`${TD} truncate`} title={v.cliente}>
                    {v.cliente}
                  </td>
                  <td className={TD}>{v.numNota ?? "—"}</td>
                  <td className={`${TD} truncate`} title={nombreRepartidor(v.repartidor)}>
                    {nombreRepartidor(v.repartidor)}
                  </td>
                  <td className={TD}>{ETIQUETA_STATUS[v.status]}</td>
                  <td className={`${TD} truncate`} title={v.factura}>
                    {v.factura}
                  </td>
                  <td className={`${TD} ${NUM}`}>{v.semana}</td>
                  <td className={`${TD} ${NUM}`}>{formatearPiezas(v.cantidad)}</td>
                  <td className={`${TD} ${NUM}`}>{formatearPiezas(v.promocion)}</td>
                  <td className={`${TD} ${NUM}`}>{formatearPesos(v.montoCentavos)}</td>
                </tr>
              ))}
              <tr className="border-t bg-muted/40 font-semibold">
                <td className={TD} colSpan={8}>
                  Total {formatearFecha(dia.fecha)}
                </td>
                <td className={`${TD} ${NUM}`}>{formatearPiezas(dia.subtotal.cantidad)}</td>
                <td className={`${TD} ${NUM}`}>{formatearPiezas(dia.subtotal.promocion)}</td>
                <td className={`${TD} ${NUM}`}>{formatearPesos(dia.subtotal.montoCentavos)}</td>
              </tr>
            </Fragment>
          ))}
          <tr className="border-t-4 border-double font-bold">
            <td className={TD} colSpan={8}>
              TOTAL
            </td>
            <td className={`${TD} ${NUM}`}>{formatearPiezas(reporte.total.cantidad)}</td>
            <td className={`${TD} ${NUM}`}>{formatearPiezas(reporte.total.promocion)}</td>
            <td className={`${TD} ${NUM}`}>{formatearPesos(reporte.total.montoCentavos)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export function ResumenRepartidores({ reporte }: { reporte: ReporteVentas }) {
  return (
    <table aria-label="Resumen por repartidor" className="w-full max-w-2xl table-fixed text-sm">
      <colgroup>
        <col />
        <col className="w-20" />
        <col className="w-24" />
        <col className="w-20" />
        <col className="w-36" />
      </colgroup>
      <thead className="border-b text-left">
        <tr>
          <th className={`${TD} font-medium`}>Repartidor</th>
          <th className={`${TD} ${NUM} font-medium`}>Ventas</th>
          <th className={`${TD} ${NUM} font-medium`}>Cantidad</th>
          <th className={`${TD} ${NUM} font-medium`}>Promo</th>
          <th className={`${TD} ${NUM} font-medium`}>Monto</th>
        </tr>
      </thead>
      <tbody>
        {reporte.porRepartidor.map((p) => (
          <tr key={p.vendedorId ?? "oficina"} className="border-t">
            <td className={`${TD} truncate`}>{nombreRepartidor(p.repartidor)}</td>
            <td className={`${TD} ${NUM}`}>{p.ventas}</td>
            <td className={`${TD} ${NUM}`}>{formatearPiezas(p.cantidad)}</td>
            <td className={`${TD} ${NUM}`}>{formatearPiezas(p.promocion)}</td>
            <td className={`${TD} ${NUM}`}>{formatearPesos(p.montoCentavos)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
