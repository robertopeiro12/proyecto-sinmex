import { Fecha } from "@/components/ui/fecha";
import { CajaTabla, FilaGrupo, FilaTotal, Tabla, Td, Th } from "@/components/ui/tabla";
import {
  etiquetaVehiculo,
  explicarSalto,
  formatearKm,
  formatearSalto,
  type ReporteKilometraje,
} from "@/lib/reportes";
import { cn } from "@/lib/utils";

/** Un `tbody` por vehiculo: encabezado, sus jornadas y su total. Gran total en el `tfoot`. */
export function TablaKilometraje({ reporte }: { reporte: ReporteKilometraje }) {
  return (
    <CajaTabla altoMaximo="70vh">
      <Tabla className="min-w-[720px]">
        <thead>
          <tr>
            <Th>Fecha</Th>
            <Th>Vendedor</Th>
            <Th alinear="derecha">Km inicial</Th>
            <Th alinear="derecha">Km final</Th>
            <Th alinear="derecha">Kilómetros</Th>
            <Th alinear="derecha">Salto</Th>
          </tr>
        </thead>
        {reporte.vehiculos.map((v) => (
          <tbody key={v.vehiculoId}>
            <FilaGrupo columnas={6}>{etiquetaVehiculo(v)}</FilaGrupo>
            {v.jornadas.map((j) => {
              const conSalto = j.saltoDecimas !== null && j.saltoDecimas !== 0;
              return (
                <tr
                  key={j.jornadaId}
                  className={cn(conSalto && "bg-warning-soft")}
                  data-salto={conSalto ? "si" : undefined}
                >
                  <Td>
                    <Fecha valor={j.fecha} />
                  </Td>
                  <Td>{j.vendedor}</Td>
                  <Td alinear="derecha">{formatearKm(j.kmInicialDecimas)}</Td>
                  <Td alinear="derecha">{formatearKm(j.kmFinalDecimas)}</Td>
                  <Td alinear="derecha">{formatearKm(j.kilometrosDecimas)}</Td>
                  <Td alinear="derecha" className="font-semibold" title={explicarSalto(j)}>
                    {formatearSalto(j.saltoDecimas)}
                  </Td>
                </tr>
              );
            })}
            <FilaTotal>
              <Td colSpan={4}>Total {etiquetaVehiculo(v)}</Td>
              <Td alinear="derecha">{formatearKm(v.totalKilometrosDecimas)}</Td>
              <Td alinear="derecha">{formatearSalto(v.totalSaltoDecimas)}</Td>
            </FilaTotal>
          </tbody>
        ))}
        <tfoot>
          <FilaTotal>
            <Td colSpan={4}>Total general</Td>
            <Td alinear="derecha">{formatearKm(reporte.totalKilometrosDecimas)}</Td>
            <Td alinear="derecha">{formatearSalto(reporte.totalSaltoDecimas)}</Td>
          </FilaTotal>
        </tfoot>
      </Tabla>
    </CajaTabla>
  );
}
