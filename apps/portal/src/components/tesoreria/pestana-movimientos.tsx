"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { mensajeDe } from "@/lib/api";
import { formatearFecha } from "@/lib/reportes";
import {
  eliminarMovimiento,
  ETIQUETA_TIPO,
  listarCuentasTesoreria,
  listarMovimientos,
  primerDiaDelMesDe,
  type CuentaTesoreria,
  type MovimientoManual,
} from "@/lib/tesoreria";
import { formatearPesos, hoyEnTijuana } from "@/lib/ventas";
import { FormularioMovimiento } from "./formulario-movimiento";

/** Registrar operación (T-29): formulario arriba y los movimientos del rango abajo. */
export function PestanaMovimientos({ sucursal }: { sucursal: string | null }) {
  const hoy = hoyEnTijuana();
  const [desde, setDesde] = useState(primerDiaDelMesDe(hoy));
  const [hasta, setHasta] = useState(hoy);
  const [cuentas, setCuentas] = useState<CuentaTesoreria[]>([]);
  const [movimientos, setMovimientos] = useState<MovimientoManual[] | null>(null);
  const [editando, setEditando] = useState<MovimientoManual | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ultima = useRef(0);

  const cargar = useCallback(async () => {
    const esta = ++ultima.current;
    setError(null);
    try {
      const lista = await listarMovimientos({ desde, hasta, sucursal });
      if (esta === ultima.current) setMovimientos(lista);
    } catch (err) {
      if (esta === ultima.current) setError(mensajeDe(err, "No se pudieron cargar los movimientos."));
    }
  }, [desde, hasta, sucursal]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  useEffect(() => {
    let vigente = true;
    listarCuentasTesoreria(sucursal).then(
      (l) => vigente && setCuentas(l),
      () => vigente && setError("No se pudieron cargar las cuentas."),
    );
    return () => {
      vigente = false;
    };
  }, [sucursal]);

  async function alEliminar(m: MovimientoManual) {
    if (!window.confirm(`¿Eliminar el ${ETIQUETA_TIPO[m.tipo].toLowerCase()} de ${formatearPesos(m.montoCentavos)} del ${formatearFecha(m.fecha)}?`)) return;
    try {
      await eliminarMovimiento(m.id);
      if (editando?.id === m.id) setEditando(null);
      void cargar();
    } catch (err) {
      setError(mensajeDe(err, "No se pudo eliminar el movimiento."));
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <FormularioMovimiento
        key={editando?.id ?? "nuevo"}
        cuentas={cuentas}
        movimiento={editando}
        alGuardar={() => {
          setEditando(null);
          void cargar();
        }}
        alCancelar={editando ? () => setEditando(null) : undefined}
      />

      <div className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="movs-desde" className="text-sm font-medium">Desde</label>
          <input id="movs-desde" type="date" value={desde} onChange={(e) => e.target.value && setDesde(e.target.value)} className="rounded-md border px-3 py-2 text-sm" />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="movs-hasta" className="text-sm font-medium">Hasta</label>
          <input id="movs-hasta" type="date" value={hasta} onChange={(e) => e.target.value && setHasta(e.target.value)} className="rounded-md border px-3 py-2 text-sm" />
        </div>
      </div>

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {movimientos === null && !error && <p className="text-sm text-muted-foreground">Cargando…</p>}
      {movimientos !== null && movimientos.length === 0 && (
        <p className="text-sm text-muted-foreground">No hay movimientos en el rango.</p>
      )}
      {movimientos !== null && movimientos.length > 0 && (
        <table className="w-full text-sm" aria-label="Movimientos registrados">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="py-2 pr-4 font-medium">Fecha</th>
              <th className="py-2 pr-4 font-medium">Tipo</th>
              <th className="py-2 pr-4 font-medium">Cuenta</th>
              <th className="py-2 pr-4 text-right font-medium">Monto</th>
              <th className="py-2 pr-4 font-medium">Comentario</th>
              <th className="py-2 pr-4 font-medium">Capturó</th>
              <th className="py-2"><span className="sr-only">Acciones</span></th>
            </tr>
          </thead>
          <tbody>
            {movimientos.map((m) => (
              <tr key={m.id} className="border-b last:border-0">
                <td className="whitespace-nowrap py-2 pr-4">{formatearFecha(m.fecha)}</td>
                <td className="whitespace-nowrap py-2 pr-4">{ETIQUETA_TIPO[m.tipo]}</td>
                <td className="py-2 pr-4">{m.cuentaDestinoNombre ? `${m.cuentaNombre} → ${m.cuentaDestinoNombre}` : m.cuentaNombre}</td>
                <td className={`whitespace-nowrap py-2 pr-4 text-right tabular-nums ${m.tipo === "retiro" ? "text-destructive" : ""}`}>
                  {formatearPesos(m.tipo === "retiro" ? -m.montoCentavos : m.montoCentavos)}
                </td>
                <td className="py-2 pr-4">{m.comentario ?? "—"}</td>
                <td className="py-2 pr-4">{m.capturo}</td>
                <td className="whitespace-nowrap py-2 text-right">
                  {m.editable && (
                    <div className="flex justify-end gap-2">
                      <Button variant="outline" size="sm" onClick={() => setEditando(m)}>Editar</Button>
                      <Button variant="outline" size="sm" onClick={() => void alEliminar(m)}>Eliminar</Button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
