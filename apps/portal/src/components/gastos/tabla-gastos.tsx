"use client";

import { useEffect, useState } from "react";
import { Receipt } from "lucide-react";
import { ETIQUETA_TIPO_EGRESO } from "@/lib/campos-egreso";
import { descargarFotoGasto, etiquetaVendedorGasto, horaEnTijuana, type GastoListado } from "@/lib/gastos";
import { formatearFecha } from "@/lib/reportes";
import { formatearPesos } from "@/lib/ventas";

/*
 * Una sola tabla `table-fixed` (como tabla-reporte-ventas.tsx) para caber desde
 * 1366 px: los anchos de `colgroup` suman 736 px fijos y Comentario se queda con
 * el resto. Toda celda lleva `px-2`; los números van a la derecha con `tabular-nums`.
 */
const TH = "sticky top-0 bg-background px-2 py-2 font-medium shadow-[inset_0_-1px_0_var(--border)]";
const TD = "px-2 py-1.5";
const NUM = "text-right tabular-nums";

export function TablaGastos({ gastos }: { gastos: GastoListado[] }) {
  const [abierto, setAbierto] = useState<GastoListado | null>(null);
  return (
    <>
      {/* `w-0 min-w-full`: la caja no aporta su ancho al `main`; la tabla se desplaza dentro. */}
      <div className="max-h-[70vh] w-0 min-w-full overflow-auto rounded-md border">
        <table aria-label="Gastos" className="w-full min-w-[60rem] table-fixed text-[13px]">
          <colgroup>
            <col className="w-22" />
            <col className="w-14" />
            <col className="w-16" />
            <col className="w-32" />
            <col className="w-36" />
            <col className="w-24" />
            <col className="w-26" />
            <col />
            <col className="w-14" />
          </colgroup>
          <thead className="text-left">
            <tr>
              <th className={TH}>Fecha</th>
              <th className={TH}>Hora</th>
              <th className={TH}>Sucursal</th>
              <th className={TH}>Vendedor</th>
              <th className={TH}>Campo</th>
              <th className={TH}>Tipo</th>
              <th className={`${TH} ${NUM}`}>Monto</th>
              <th className={TH}>Comentario</th>
              <th className={`${TH} text-center`}>Ticket</th>
            </tr>
          </thead>
          <tbody>
            {gastos.map((g) => (
              <tr key={g.id} className="border-t">
                <td className={TD}>{formatearFecha(g.fecha)}</td>
                <td className={`${TD} tabular-nums`}>{horaEnTijuana(g.registradoEn)}</td>
                <td className={TD}>{g.sucursalCodigo}</td>
                <td className={`${TD} truncate`} title={etiquetaVendedorGasto(g)}>
                  {etiquetaVendedorGasto(g)}
                </td>
                <td className={`${TD} truncate`} title={g.campoNombre}>
                  {g.campoNombre}
                </td>
                <td className={TD}>{ETIQUETA_TIPO_EGRESO[g.tipo]}</td>
                <td className={`${TD} ${NUM}`}>{formatearPesos(g.montoCentavos)}</td>
                <td className={`${TD} truncate`} title={g.comentario ?? undefined}>
                  {g.comentario ?? "—"}
                </td>
                <td className={`${TD} text-center`}>
                  {g.tieneFoto && (
                    <button
                      type="button"
                      onClick={() => setAbierto(g)}
                      aria-label={`Ver el ticket de ${g.campoNombre}`}
                      title="Ver el ticket"
                      className="inline-flex rounded p-1 hover:bg-muted"
                    >
                      <Receipt className="size-4" aria-hidden="true" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {abierto && <TicketGasto key={abierto.id} gasto={abierto} alCerrar={() => setAbierto(null)} />}
    </>
  );
}

/**
 * El ticket ampliado. Los bytes se piden con `fetch` (refresca la sesión) y se pintan
 * con una URL de objeto que se revoca al cerrar, como `FotoProspecto`. Un fallo no
 * rompe la tabla: lo dice en el mismo diálogo.
 */
function TicketGasto({ gasto, alCerrar }: { gasto: GastoListado; alCerrar: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [fallo, setFallo] = useState(false);

  useEffect(() => {
    let vigente = true;
    let creada: string | null = null;
    descargarFotoGasto(gasto.id)
      .then((blob) => {
        if (!vigente) return;
        creada = URL.createObjectURL(blob);
        setUrl(creada);
      })
      .catch(() => {
        if (vigente) setFallo(true);
      });
    return () => {
      vigente = false;
      if (creada) URL.revokeObjectURL(creada);
    };
  }, [gasto.id]);

  useEffect(() => {
    const alTeclear = (evento: KeyboardEvent) => {
      if (evento.key === "Escape") alCerrar();
    };
    window.addEventListener("keydown", alTeclear);
    return () => window.removeEventListener("keydown", alTeclear);
  }, [alCerrar]);

  const titulo = `Ticket de ${gasto.campoNombre}`;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={titulo}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
    >
      {fallo && (
        <p role="alert" className="rounded-md bg-white px-3 py-2 text-sm text-black">
          No se pudo cargar el ticket.
        </p>
      )}
      {!fallo && url === null && <p className="text-sm text-white">Cargando el ticket…</p>}
      {url !== null && (
        // eslint-disable-next-line @next/next/no-img-element -- el src es un blob: del navegador; next/image no lo ve.
        <img src={url} alt={titulo} className="max-h-full max-w-full rounded" />
      )}
      <button
        type="button"
        onClick={alCerrar}
        className="absolute right-4 top-4 rounded-md bg-white px-3 py-1.5 text-sm font-medium text-black"
      >
        Cerrar
      </button>
    </div>
  );
}
