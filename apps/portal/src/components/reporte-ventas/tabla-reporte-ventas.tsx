import { Fragment } from "react";
import { CajaTabla, FilaTotal, Tabla, Td, TdMonto, Th } from "@/components/ui/tabla";
import { formatearFecha } from "@/lib/reportes";
import { formatearPiezas, nombreRepartidor, type ReporteVentas } from "@/lib/reporte-ventas";
import { ETIQUETA_STATUS } from "@/lib/ventas";

/*
 * Una sola tabla `table-fixed` para todo el rango (nunca una por día) para que
 * las columnas queden alineadas. Los anchos del `colgroup` se midieron para 1366 px
 * con celdas de `px-2` y letra de 13 px (T-49): las piezas comunes llevan `px-3`
 * y 14 px, así que aquí se vuelve a `px-2`/`py-1.5` para que nada cambie de ancho.
 */
const TH = "px-2 py-2";
const TD = "px-2 py-1.5";

export function TablaReporteVentas({ reporte }: { reporte: ReporteVentas }) {
  // `w-0 min-w-full`: la caja no aporta su ancho de contenido al `main` (flex-1 sin
  // min-w-0 en el layout compartido); ocupa el ancho disponible y la tabla se desplaza dentro.
  return (
    <CajaTabla altoMaximo="70vh" className="w-0 min-w-full">
      <Tabla aria-label="Ventas" className="min-w-[61rem] table-fixed text-[13px]">
        <colgroup>
          <col className="w-22" />
          <col className="w-28" />
          <col />
          <col className="w-14" />
          <col className="w-24" />
          <col className="w-27" />
          <col className="w-16" />
          <col className="w-17" />
          <col className="w-18" />
          <col className="w-14" />
          <col className="w-28" />
        </colgroup>
        <thead>
          <tr>
            <Th className={TH}>Fecha</Th>
            <Th className={TH}>Folio</Th>
            <Th className={TH}>Cliente</Th>
            <Th className={TH}># nota</Th>
            <Th className={TH}>Repartidor</Th>
            <Th className={TH}>Status</Th>
            <Th className={TH}>Factura</Th>
            <Th alinear="derecha" className={TH}>Semana</Th>
            <Th alinear="derecha" className={TH}>Cantidad</Th>
            <Th alinear="derecha" className={TH}>Promo</Th>
            <Th alinear="derecha" className={TH}>Monto</Th>
          </tr>
        </thead>
        <tbody>
          {reporte.dias.map((dia) => (
            <Fragment key={dia.fecha}>
              {dia.ventas.map((v) => (
                <tr key={v.id}>
                  <Td className={TD}>{formatearFecha(v.fecha)}</Td>
                  <Td className={`${TD} font-mono`}>{v.folio}</Td>
                  <Td className={`${TD} truncate`} title={v.cliente}>
                    {v.cliente}
                  </Td>
                  <Td className={TD}>{v.numNota ?? "—"}</Td>
                  <Td className={`${TD} truncate`} title={nombreRepartidor(v.repartidor)}>
                    {nombreRepartidor(v.repartidor)}
                  </Td>
                  <Td className={TD}>{ETIQUETA_STATUS[v.status]}</Td>
                  <Td className={`${TD} truncate`} title={v.factura}>
                    {v.factura}
                  </Td>
                  <Td alinear="derecha" className={TD}>{v.semana}</Td>
                  <Td alinear="derecha" className={TD}>{formatearPiezas(v.cantidad)}</Td>
                  <Td alinear="derecha" className={TD}>{formatearPiezas(v.promocion)}</Td>
                  <TdMonto centavos={v.montoCentavos} className={TD} />
                </tr>
              ))}
              {/* Subtotal del día: fila en negrita sin el doble borde del total general. */}
              <tr className="bg-menu font-semibold">
                <Td className={TD} colSpan={8}>
                  Total {formatearFecha(dia.fecha)}
                </Td>
                <Td alinear="derecha" className={TD}>{formatearPiezas(dia.subtotal.cantidad)}</Td>
                <Td alinear="derecha" className={TD}>{formatearPiezas(dia.subtotal.promocion)}</Td>
                <TdMonto centavos={dia.subtotal.montoCentavos} className={TD} />
              </tr>
            </Fragment>
          ))}
          <FilaTotal className="font-bold">
            <Td className={TD} colSpan={8}>
              TOTAL
            </Td>
            <Td alinear="derecha" className={TD}>{formatearPiezas(reporte.total.cantidad)}</Td>
            <Td alinear="derecha" className={TD}>{formatearPiezas(reporte.total.promocion)}</Td>
            <TdMonto centavos={reporte.total.montoCentavos} className={TD} />
          </FilaTotal>
        </tbody>
      </Tabla>
    </CajaTabla>
  );
}

export function ResumenRepartidores({ reporte }: { reporte: ReporteVentas }) {
  return (
    <CajaTabla className="max-w-2xl">
      <Tabla aria-label="Resumen por repartidor" className="table-fixed text-[13px]">
        <colgroup>
          <col />
          <col className="w-20" />
          <col className="w-24" />
          <col className="w-20" />
          <col className="w-30" />
        </colgroup>
        <thead>
          <tr>
            <Th className={TH}>Repartidor</Th>
            <Th alinear="derecha" className={TH}>Ventas</Th>
            <Th alinear="derecha" className={TH}>Cantidad</Th>
            <Th alinear="derecha" className={TH}>Promo</Th>
            <Th alinear="derecha" className={TH}>Monto</Th>
          </tr>
        </thead>
        <tbody>
          {reporte.porRepartidor.map((p) => (
            <tr key={p.vendedorId ?? "oficina"}>
              <Td className={`${TD} truncate`}>{nombreRepartidor(p.repartidor)}</Td>
              <Td alinear="derecha" className={TD}>{p.ventas}</Td>
              <Td alinear="derecha" className={TD}>{formatearPiezas(p.cantidad)}</Td>
              <Td alinear="derecha" className={TD}>{formatearPiezas(p.promocion)}</Td>
              <TdMonto centavos={p.montoCentavos} className={TD} />
            </tr>
          ))}
        </tbody>
      </Tabla>
    </CajaTabla>
  );
}
