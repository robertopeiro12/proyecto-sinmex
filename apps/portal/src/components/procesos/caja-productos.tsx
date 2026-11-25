"use client";

import { useMemo, useState } from "react";
import { X } from "lucide-react";
import { Entrada } from "@/components/ui/campo";
import { MAX_PIEZAS_PROCESO } from "@/lib/procesos";
import { cn } from "@/lib/utils";
import { normalizarTexto } from "@/lib/ventas";

/** Una presentación que se puede agregar: "Horchata 500 ml". */
export interface OpcionPresentacion {
  id: string;
  nombre: string;
  producto: string;
  volumen: string;
}

/** Un renglón de la caja; las piezas como texto, tal como se escriben. */
export interface RenglonCaja {
  presentacionId: string;
  nombre: string;
  producto: string;
  volumen: string;
  piezas: string;
}

const ENTERO = /^\d+$/;
export const piezasValidas = (texto: string) => {
  const t = texto.trim();
  return ENTERO.test(t) && Number(t) >= 1 && Number(t) <= MAX_PIEZAS_PROCESO;
};

/**
 * Una caja de la captura (D1, boceto 2): una tabla sencilla con el título de la caja y
 * "Piezas" de encabezado, renglones producto · piezas · ✕ en el orden en que se agregaron, y
 * "+ Agregar producto" con un buscador de presentaciones activas. Sin fondos de color. Una
 * presentación va una sola vez por caja.
 */
export function CajaProductos({
  titulo,
  renglones,
  opciones,
  onCambio,
  disabled = false,
}: {
  titulo: string;
  renglones: RenglonCaja[];
  opciones: OpcionPresentacion[];
  onCambio: (renglones: RenglonCaja[]) => void;
  disabled?: boolean;
}) {
  const [buscando, setBuscando] = useState(false);
  const [busqueda, setBusqueda] = useState("");

  const disponibles = useMemo(() => {
    const ya = new Set(renglones.map((r) => r.presentacionId));
    const q = normalizarTexto(busqueda.trim());
    return opciones.filter((o) => !ya.has(o.id) && (q === "" || normalizarTexto(o.nombre).includes(q))).slice(0, 8);
  }, [opciones, renglones, busqueda]);

  function agregar(o: OpcionPresentacion) {
    onCambio([...renglones, { presentacionId: o.id, nombre: o.nombre, producto: o.producto, volumen: o.volumen, piezas: "" }]);
    setBusqueda("");
    setBuscando(false);
  }

  const COLUMNAS = "grid grid-cols-[minmax(0,1fr)_5rem_1.75rem] items-center gap-3 px-4";

  return (
    <section aria-label={titulo} className="flex min-w-0 flex-col overflow-hidden rounded-[10px] border">
      <header className={cn(COLUMNAS, "border-b py-2.5 text-[13px] font-semibold text-muted-foreground")}>
        <span className="truncate">{titulo}</span>
        <span className="text-right">Piezas</span>
        <span />
      </header>
      <ul className="flex flex-col">
        {renglones.map((r) => {
          const invalido = r.piezas.trim() !== "" && !piezasValidas(r.piezas);
          return (
            <li key={r.presentacionId} className={cn(COLUMNAS, "border-b py-2 text-sm")}>
              <span className="min-w-0 truncate" title={r.nombre}>
                {r.nombre}
              </span>
              <Entrada
                type="text"
                inputMode="numeric"
                aria-label={`Piezas de ${r.nombre} en ${titulo}`}
                aria-invalid={invalido || undefined}
                disabled={disabled}
                className="w-20 text-right"
                value={r.piezas}
                onChange={(e) =>
                  onCambio(renglones.map((x) => (x.presentacionId === r.presentacionId ? { ...x, piezas: e.target.value } : x)))
                }
              />
              <button
                type="button"
                aria-label={`Quitar ${r.nombre} de ${titulo}`}
                disabled={disabled}
                onClick={() => onCambio(renglones.filter((x) => x.presentacionId !== r.presentacionId))}
                className="grid size-7 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X aria-hidden className="size-4" />
              </button>
            </li>
          );
        })}
      </ul>
      <div className="px-4 py-2.5">
        {buscando ? (
          <div className="flex flex-col gap-1.5">
            <Entrada
              type="search"
              autoFocus
              autoComplete="off"
              aria-label={`Buscar producto para ${titulo}`}
              placeholder="Escribe el producto"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setBuscando(false);
                  setBusqueda("");
                }
                if (e.key === "Enter" && disponibles.length > 0) {
                  e.preventDefault();
                  agregar(disponibles[0]);
                }
              }}
            />
            {disponibles.length > 0 ? (
              <ul role="listbox" aria-label={`Productos para ${titulo}`} className="flex flex-col rounded-md border">
                {disponibles.map((o) => (
                  <li key={o.id} role="presentation">
                    <button
                      type="button"
                      role="option"
                      aria-selected={false}
                      onClick={() => agregar(o)}
                      className="w-full px-3 py-1.5 text-left text-sm hover:bg-accent"
                    >
                      {o.nombre}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground">No hay más productos con ese nombre.</p>
            )}
          </div>
        ) : (
          <button
            type="button"
            aria-label={`Agregar producto a ${titulo}`}
            disabled={disabled}
            onClick={() => setBuscando(true)}
            className="text-sm font-semibold text-sucursal hover:underline disabled:opacity-50"
          >
            + Agregar producto
          </button>
        )}
      </div>
    </section>
  );
}
