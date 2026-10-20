"use client";

import Link from "next/link";
import { Collapsible } from "@base-ui/react/collapsible";
import { ChevronDown } from "lucide-react";
import { useEffect, useState } from "react";
import { guardarLocal, leerLocal } from "@/lib/almacen-local";
import { cn } from "@/lib/utils";
import { buscarItemActual, navSections } from "./nav-config";

export const CLAVE_SECCIONES = "jawa.menu.secciones";

type Abiertas = Record<string, boolean>;

/** Lo guardado, o nada si no hay, no se puede leer o es basura. */
function leerGuardadas(): Abiertas {
  const texto = leerLocal(CLAVE_SECCIONES);
  if (!texto) return {};
  try {
    const valor: unknown = JSON.parse(texto);
    if (typeof valor !== "object" || valor === null || Array.isArray(valor)) return {};
    return Object.fromEntries(Object.entries(valor).filter(([, v]) => typeof v === "boolean")) as Abiertas;
  } catch {
    return {};
  }
}

/**
 * Las secciones del menú (UI Etapa 1, spec §3.3): cada una se abre y se cierra; la de
 * la pantalla actual se abre sola al entrar; lo demás se recuerda en esta computadora.
 */
export function SeccionesMenu({ pathname, sucursal }: { pathname: string; sucursal: string | null }) {
  const actual = buscarItemActual(pathname);
  const seccionActual = actual?.seccion ?? null;
  // En el servidor no hay localStorage: se arranca solo con la sección actual.
  const [abiertas, setAbiertas] = useState<Abiertas>(() => (seccionActual ? { [seccionActual]: true } : {}));

  useEffect(() => {
    const guardadas = leerGuardadas();
    // Lo que ya está en pantalla (la sección actual abierta) gana sobre lo guardado.
    setAbiertas((enPantalla) => ({ ...guardadas, ...enPantalla }));
  }, []);

  useEffect(() => {
    if (seccionActual) {
      setAbiertas((enPantalla) => (enPantalla[seccionActual] ? enPantalla : { ...enPantalla, [seccionActual]: true }));
    }
  }, [seccionActual]);

  function alternar(seccion: string, abrir: boolean) {
    const nuevas = { ...abiertas, [seccion]: abrir };
    setAbiertas(nuevas);
    guardarLocal(CLAVE_SECCIONES, JSON.stringify(nuevas));
  }

  const sufijo = sucursal ? `?sucursal=${encodeURIComponent(sucursal)}` : "";

  return (
    <nav aria-label="Menú principal" className="flex flex-col gap-0.5">
      {navSections.map((seccion) => {
        const abierta = abiertas[seccion.label] ?? false;
        return (
          <Collapsible.Root
            key={seccion.label}
            open={abierta}
            onOpenChange={(abrir) => alternar(seccion.label, abrir)}
          >
            <Collapsible.Trigger className="flex w-full items-center justify-between rounded-md px-2 py-2 text-sm font-semibold outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-sucursal/40">
              {seccion.label}
              <ChevronDown
                aria-hidden
                className={cn(
                  "size-4 text-muted-foreground transition-transform duration-150",
                  !abierta && "-rotate-90",
                )}
              />
            </Collapsible.Trigger>
            <Collapsible.Panel className="h-[var(--collapsible-panel-height)] overflow-hidden transition-[height] duration-150 data-[ending-style]:h-0 data-[starting-style]:h-0">
              <ul className="mb-1.5 flex flex-col gap-px">
                {seccion.items.map((item) => {
                  const activo = actual?.item.href === item.href;
                  return (
                    <li key={item.href}>
                      <Link
                        href={`${item.href}${sufijo}`}
                        aria-current={activo ? "page" : undefined}
                        className={cn(
                          "flex items-center justify-between gap-2 rounded-md py-1.5 pr-2 pl-5 text-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-sucursal/40",
                          activo && "bg-background font-semibold shadow-[inset_3px_0_0_var(--suc)]",
                        )}
                      >
                        <span>{item.label}</span>{" "}
                        {item.pronto && (
                          <span className="rounded-full border px-1.5 text-[11px] font-normal text-muted-foreground">
                            Pronto
                          </span>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </Collapsible.Panel>
          </Collapsible.Root>
        );
      })}
    </nav>
  );
}
