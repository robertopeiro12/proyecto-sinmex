"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Campo, Entrada } from "@/components/ui/campo";
import type { ClienteResumen } from "@/lib/clientes";
import { cn } from "@/lib/utils";
import { normalizarTexto } from "@/lib/ventas";

/**
 * Búsqueda de cliente por nombre (T-17). La usan "Registrar venta", la búsqueda de ventas,
 * facturas, cobranza y Procesos; `clientes` ya viene acotado al alcance del usuario.
 *
 * Es un combobox: al enfocar el cuadro (antes de escribir) salen **todos** los clientes en
 * orden alfabético y al escribir se van filtrando. La lista flota encima del contenido (no lo
 * empuja). Flechas mueven, Enter elige, Escape cierra; salir del cuadro (clic fuera, Tab) cierra.
 *
 * `variante="campo"` (Procesos): sin etiqueta visible y, ya elegido, el nombre dentro de un
 * campo con ✕ para quitarlo. La normal deja la etiqueta "Cliente" y un botón con texto.
 */
export function BuscadorCliente({
  clientes,
  cliente,
  onElegir,
  onQuitar,
  etiquetaQuitar = "Cambiar",
  disabled = false,
  variante = "normal",
  className,
}: {
  clientes: ClienteResumen[];
  cliente: ClienteResumen | null;
  onElegir: (cliente: ClienteResumen) => void;
  onQuitar: () => void;
  etiquetaQuitar?: string;
  disabled?: boolean;
  variante?: "normal" | "campo";
  /** Ancho del campo (por omisión `w-72`). */
  className?: string;
}) {
  const id = useId();
  const idLista = `${id}-lista`;
  const [busqueda, setBusqueda] = useState("");
  const [abierto, setAbierto] = useState(false);
  const [activo, setActivo] = useState(-1);
  // Tras picar "quitar", el cuadro que aparece se enfoca (y con eso abre la lista).
  const [enfocar, setEnfocar] = useState(false);
  const opciones = useRef<(HTMLLIElement | null)[]>([]);

  const ordenados = useMemo(() => [...clientes].sort((a, b) => a.nombre.localeCompare(b.nombre, "es")), [clientes]);

  const coincidencias = useMemo(() => {
    const q = normalizarTexto(busqueda.trim());
    if (q === "") return ordenados;
    return ordenados.filter((c) => normalizarTexto(c.nombre).includes(q));
  }, [busqueda, ordenados]);

  useEffect(() => {
    if (activo >= 0) opciones.current[activo]?.scrollIntoView?.({ block: "nearest" });
  }, [activo]);

  const sufijo = (c: ClienteResumen) => ` · ${c.sucursalCodigo}${c.tipo === "prospecto" ? " · Prospecto" : ""}`;
  const etiqueta = (c: ClienteResumen) => `${c.nombre}${sufijo(c)}`;

  function elegir(c: ClienteResumen) {
    setBusqueda("");
    setAbierto(false);
    setActivo(-1);
    onElegir(c);
  }

  function alTeclear(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!abierto) {
        setAbierto(true);
        return;
      }
      if (coincidencias.length === 0) return;
      const paso = e.key === "ArrowDown" ? 1 : -1;
      setActivo((a) => (a < 0 ? (paso > 0 ? 0 : coincidencias.length - 1) : (a + paso + coincidencias.length) % coincidencias.length));
    } else if (e.key === "Enter") {
      if (abierto && activo >= 0 && activo < coincidencias.length) {
        e.preventDefault();
        elegir(coincidencias[activo]);
      }
    } else if (e.key === "Escape") {
      if (abierto) {
        e.preventDefault();
        setAbierto(false);
        setActivo(-1);
      }
    }
  }

  const campo = variante === "campo";
  const mostrarLista = abierto && !disabled && clientes.length > 0;

  return (
    <Campo id={id} etiqueta="Cliente" etiquetaOculta={campo} className={cn("w-72", className)}>
      {cliente ? (
        campo ? (
          <div className="flex h-10 min-w-0 items-center gap-2 rounded-[7px] border border-input bg-background pr-1.5 pl-3 text-sm">
            <span className="min-w-0 flex-1 truncate font-semibold" title={cliente.nombre}>
              {cliente.nombre}
            </span>
            <button
              type="button"
              aria-label={etiquetaQuitar}
              disabled={disabled}
              onClick={() => {
                setEnfocar(true);
                onQuitar();
              }}
              className="grid size-7 shrink-0 place-items-center rounded text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-sucursal disabled:opacity-50"
            >
              <X aria-hidden className="size-4" />
            </button>
          </div>
        ) : (
          <div className="flex min-w-0 items-center gap-2 text-sm">
            <span className="min-w-0 truncate" title={etiqueta(cliente)}>
              {etiqueta(cliente)}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled}
              onClick={() => {
                setEnfocar(true);
                onQuitar();
              }}
            >
              {etiquetaQuitar}
            </Button>
          </div>
        )
      ) : (
        <div className="relative">
          <Entrada
            role="combobox"
            aria-expanded={mostrarLista}
            aria-controls={idLista}
            aria-autocomplete="list"
            aria-activedescendant={mostrarLista && activo >= 0 ? `${id}-op-${activo}` : undefined}
            autoComplete="off"
            autoFocus={enfocar}
            disabled={disabled}
            placeholder="Escribe el nombre del cliente"
            value={busqueda}
            className={cn("w-full", campo && "h-10")}
            onFocus={() => {
              setEnfocar(false);
              setAbierto(true);
            }}
            onClick={() => setAbierto(true)}
            onBlur={() => {
              setAbierto(false);
              setActivo(-1);
            }}
            onChange={(e) => {
              setBusqueda(e.target.value);
              setAbierto(true);
              setActivo(e.target.value.trim() === "" ? -1 : 0);
            }}
            onKeyDown={alTeclear}
          />
          {mostrarLista &&
            (coincidencias.length > 0 ? (
              <ul
                id={idLista}
                role="listbox"
                aria-label="Clientes"
                className="absolute top-full right-0 left-0 z-50 mt-1 max-h-72 overflow-y-auto rounded-[7px] border bg-popover py-1 text-popover-foreground shadow-[0_8px_24px_rgb(0_0_0/0.14)]"
              >
                {coincidencias.map((c, i) => (
                  <li
                    key={c.id}
                    id={`${id}-op-${i}`}
                    ref={(el) => {
                      opciones.current[i] = el;
                    }}
                    role="option"
                    aria-selected={i === activo}
                    title={etiqueta(c)}
                    // Que el cuadro no pierda el foco (su blur cerraría la lista antes del clic).
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setActivo(i)}
                    onClick={() => elegir(c)}
                    className={cn("cursor-pointer truncate px-3 py-1.5 text-sm", i === activo && "bg-accent")}
                  >
                    {c.nombre}
                    <span className="text-muted-foreground">{sufijo(c)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p
                id={idLista}
                className="absolute top-full right-0 left-0 z-50 mt-1 rounded-[7px] border bg-popover px-3 py-2 text-sm text-muted-foreground shadow-[0_8px_24px_rgb(0_0_0/0.14)]"
              >
                Ningún cliente con ese nombre.
              </p>
            ))}
        </div>
      )}
    </Campo>
  );
}
