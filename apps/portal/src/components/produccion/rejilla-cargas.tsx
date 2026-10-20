"use client";

import { Button } from "@/components/ui/button";
import {
  cargaEditable,
  columnasDeVendedor,
  ETIQUETA_ESTADO,
  piezasDe,
  totalBorrador,
  totalPiezas,
  type Borrador,
  type CargaRejilla,
  type Columna,
  type EstadoCarga,
  type PresentacionRejilla,
  type Rejilla,
  type VendedorRejilla,
} from "@/lib/cargas";

/** La subcolumna que se esta capturando: una carga existente o una nueva (`carga: null`). */
export interface Edicion {
  vendedorId: string;
  carga: CargaRejilla | null;
  borrador: Borrador;
}

interface Props {
  rejilla: Rejilla;
  esHoy: boolean;
  edicion: Edicion | null;
  ocupado: boolean;
  onNueva: (vendedorId: string) => void;
  onEditar: (vendedorId: string, carga: CargaRejilla) => void;
  onEliminar: (vendedorNombre: string, carga: CargaRejilla) => void;
  onPiezas: (presentacionId: string, texto: string) => void;
  onGuardar: () => void;
  onCancelar: () => void;
}

const PASTILLA: Record<EstadoCarga, string> = {
  pendiente: "border-amber-300 bg-amber-50 text-amber-800",
  aceptada: "border-emerald-300 bg-emerald-50 text-emerald-800",
  rechazada: "border-red-300 bg-red-50 text-red-800",
};

/*
 * Diseñada para 1366 px (≈1012 px de caja): la columna de presentación mide 192 px
 * (`w-48`) y cada subcolumna 112 px (`w-28`), así que caben 7 cargas sin desplazar;
 * con más, la tabla se desplaza de lado DENTRO de su caja (`w-0 min-w-full`) con la
 * presentación fija (`sticky left-0`) y el encabezado fijo (`thead sticky top-0`).
 * Medido en el navegador antes de cerrar la tarea.
 */
const TH = "border-b px-2 py-1.5 text-left align-top font-medium";
const CELDA = "w-28 min-w-28 border-b border-l px-2 py-1 text-right tabular-nums";
const FIJA = "sticky left-0 z-10 w-48 min-w-48 border-b bg-background px-2 py-1 text-left";

function enEdicion(columna: Columna, vendedor: VendedorRejilla, edicion: Edicion | null): boolean {
  if (edicion === null || edicion.vendedorId !== vendedor.id) return false;
  if (columna.tipo === "nueva") return true;
  return columna.tipo === "carga" && edicion.carga?.id === columna.carga.id;
}

function claveDe(vendedor: VendedorRejilla, columna: Columna): string {
  return columna.tipo === "carga" ? columna.carga.id : `${vendedor.id}-${columna.tipo}`;
}

export function RejillaCargas(props: Props) {
  const { rejilla, esHoy, edicion, ocupado } = props;
  // Una sola subcolumna editable a la vez: mientras se captura, lo demas se congela.
  const libre = esHoy && edicion === null && !ocupado;

  if (rejilla.vendedores.length === 0) {
    return <p className="text-sm text-muted-foreground">Esta sucursal no tiene vendedores activos.</p>;
  }

  const grupos = rejilla.vendedores.map((vendedor) => ({
    vendedor,
    columnas: columnasDeVendedor(
      vendedor,
      edicion !== null && edicion.vendedorId === vendedor.id && edicion.carga === null,
    ),
  }));

  function botonesEdicion() {
    return (
      <div className="mt-1 flex gap-1">
        <Button type="button" size="xs" disabled={ocupado} onClick={props.onGuardar}>
          {ocupado ? "Guardando…" : "Guardar"}
        </Button>
        <Button type="button" size="xs" variant="outline" disabled={ocupado} onClick={props.onCancelar}>
          Cancelar
        </Button>
      </div>
    );
  }

  function encabezado(vendedor: VendedorRejilla, columna: Columna) {
    const editando = enEdicion(columna, vendedor, edicion);
    if (columna.tipo === "vacia") {
      return <span className="font-normal text-muted-foreground">Sin cargas</span>;
    }
    if (columna.tipo === "nueva") {
      return (
        <>
          <span>Nueva</span>
          {botonesEdicion()}
        </>
      );
    }
    const { carga } = columna;
    return (
      <>
        <div className="flex items-center justify-between gap-1">
          <span>n.º {carga.numero}</span>
          <span className={`rounded-full border px-1.5 text-[11px] font-normal ${PASTILLA[carga.estado]}`}>
            {ETIQUETA_ESTADO[carga.estado]}
          </span>
        </div>
        {carga.estado === "rechazada" && carga.motivoRechazo ? (
          <p className="mt-0.5 whitespace-normal text-[11px] font-normal text-destructive">{carga.motivoRechazo}</p>
        ) : null}
        {editando ? (
          botonesEdicion()
        ) : cargaEditable(carga, esHoy) ? (
          <div className="mt-1 flex gap-1">
            <Button
              type="button"
              size="xs"
              variant="outline"
              disabled={!libre}
              aria-label={`Editar la carga n.º ${carga.numero} de ${vendedor.nombre}`}
              onClick={() => props.onEditar(vendedor.id, carga)}
            >
              Editar
            </Button>
            <Button
              type="button"
              size="xs"
              variant="destructive"
              disabled={!libre}
              aria-label={`Eliminar la carga n.º ${carga.numero} de ${vendedor.nombre}`}
              onClick={() => props.onEliminar(vendedor.nombre, carga)}
            >
              Eliminar
            </Button>
          </div>
        ) : null}
      </>
    );
  }

  function celda(vendedor: VendedorRejilla, columna: Columna, presentacion: PresentacionRejilla) {
    if (enEdicion(columna, vendedor, edicion) && edicion) {
      if (!presentacion.activa) return <span className="text-muted-foreground">—</span>;
      return (
        <input
          type="text"
          inputMode="numeric"
          aria-label={`${vendedor.nombre} · ${presentacion.productoNombre} ${presentacion.volumen}`}
          value={edicion.borrador[presentacion.id] ?? ""}
          disabled={ocupado}
          onChange={(e) => props.onPiezas(presentacion.id, e.target.value)}
          className="w-full rounded border px-1 py-0.5 text-right tabular-nums"
        />
      );
    }
    if (columna.tipo !== "carga") return null;
    const piezas = piezasDe(columna.carga, presentacion.id);
    return piezas === null ? <span className="text-muted-foreground">—</span> : piezas;
  }

  function total(vendedor: VendedorRejilla, columna: Columna) {
    if (enEdicion(columna, vendedor, edicion) && edicion) return totalBorrador(edicion.borrador);
    return columna.tipo === "carga" ? totalPiezas(columna.carga.lineas) : null;
  }

  /** Una rechazada queda resaltada hasta que se edite (spec, portal). */
  function fondo(vendedor: VendedorRejilla, columna: Columna): string {
    return columna.tipo === "carga" &&
      columna.carga.estado === "rechazada" &&
      !enEdicion(columna, vendedor, edicion)
      ? "bg-red-50"
      : "";
  }

  return (
    <div className="max-h-[70vh] w-0 min-w-full overflow-auto rounded-md border">
      <table aria-label="Cargas del día" className="border-separate border-spacing-0 text-[13px]">
        <thead className="sticky top-0 z-20 bg-background">
          <tr>
            <th rowSpan={2} scope="col" className={`${FIJA} z-30 font-medium`}>
              Presentación
            </th>
            {grupos.map(({ vendedor, columnas }) => (
              <th key={vendedor.id} colSpan={columnas.length} scope="colgroup" className={`${TH} border-l`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate" title={vendedor.nombre}>
                    {vendedor.nombre}
                  </span>
                  {esHoy ? (
                    <Button
                      type="button"
                      size="xs"
                      variant="outline"
                      disabled={!libre}
                      aria-label={`Nueva carga para ${vendedor.nombre}`}
                      onClick={() => props.onNueva(vendedor.id)}
                    >
                      Nueva carga
                    </Button>
                  ) : null}
                </div>
              </th>
            ))}
          </tr>
          <tr>
            {grupos.flatMap(({ vendedor, columnas }) =>
              columnas.map((columna) => (
                <th
                  key={claveDe(vendedor, columna)}
                  scope="col"
                  className={`${TH} w-28 min-w-28 border-l ${fondo(vendedor, columna)}`}
                >
                  {encabezado(vendedor, columna)}
                </th>
              )),
            )}
          </tr>
        </thead>
        <tbody>
          {rejilla.presentaciones.map((presentacion) => (
            <tr key={presentacion.id}>
              <th scope="row" className={`${FIJA} font-normal`}>
                {presentacion.productoNombre} {presentacion.volumen}
                {presentacion.activa ? "" : <span className="text-muted-foreground"> (baja)</span>}
              </th>
              {grupos.flatMap(({ vendedor, columnas }) =>
                columnas.map((columna) => (
                  <td key={claveDe(vendedor, columna)} className={`${CELDA} ${fondo(vendedor, columna)}`}>
                    {celda(vendedor, columna, presentacion)}
                  </td>
                )),
              )}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row" className={`${FIJA} font-medium`}>
              Total de piezas
            </th>
            {grupos.flatMap(({ vendedor, columnas }) =>
              columnas.map((columna) => (
                <td key={claveDe(vendedor, columna)} className={`${CELDA} font-medium ${fondo(vendedor, columna)}`}>
                  {total(vendedor, columna)}
                </td>
              )),
            )}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
