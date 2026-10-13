import {
  etiquetaVehiculo,
  explicarSalto,
  formatearFecha,
  formatearKm,
  formatearSalto,
  type ReporteKilometraje,
} from "@/lib/reportes";
import { cn } from "@/lib/utils";

/** Un `tbody` por vehiculo: encabezado, sus jornadas y su total. Gran total en el `tfoot`. */
export function TablaKilometraje({ reporte }: { reporte: ReporteKilometraje }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-muted-foreground">
          <th className="py-2">Fecha</th>
          <th>Vendedor</th>
          <th className="text-right">Km inicial</th>
          <th className="text-right">Km final</th>
          <th className="text-right">Kilómetros</th>
          <th className="text-right">Salto</th>
        </tr>
      </thead>
      {reporte.vehiculos.map((v) => (
        <tbody key={v.vehiculoId}>
          <tr className="border-t bg-muted/40">
            <th colSpan={6} scope="rowgroup" className="py-2 text-left font-semibold">
              {etiquetaVehiculo(v)}
            </th>
          </tr>
          {v.jornadas.map((j) => {
            const conSalto = j.saltoDecimas !== null && j.saltoDecimas !== 0;
            return (
              <tr
                key={j.jornadaId}
                className={cn("border-t", conSalto && "bg-amber-50")}
                data-salto={conSalto ? "si" : undefined}
              >
                <td className="py-1.5">{formatearFecha(j.fecha)}</td>
                <td>{j.vendedor}</td>
                <td className="text-right">{formatearKm(j.kmInicialDecimas)}</td>
                <td className="text-right">{formatearKm(j.kmFinalDecimas)}</td>
                <td className="text-right">{formatearKm(j.kilometrosDecimas)}</td>
                <td className="text-right font-semibold" title={explicarSalto(j)}>
                  {formatearSalto(j.saltoDecimas)}
                </td>
              </tr>
            );
          })}
          <tr className="border-t font-semibold">
            <td colSpan={4} className="py-1.5">
              Total {etiquetaVehiculo(v)}
            </td>
            <td className="text-right">{formatearKm(v.totalKilometrosDecimas)}</td>
            <td className="text-right">{formatearSalto(v.totalSaltoDecimas)}</td>
          </tr>
        </tbody>
      ))}
      <tfoot>
        <tr className="border-t-2 font-semibold">
          <td colSpan={4} className="py-2">
            Total general
          </td>
          <td className="text-right">{formatearKm(reporte.totalKilometrosDecimas)}</td>
          <td className="text-right">{formatearSalto(reporte.totalSaltoDecimas)}</td>
        </tr>
      </tfoot>
    </table>
  );
}
