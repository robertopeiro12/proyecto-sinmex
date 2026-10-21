"use client";

import { Tabs } from "@base-ui/react/tabs";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface Pestana {
  valor: string;
  etiqueta: string;
  contenido: ReactNode;
}

/**
 * Pestañas (UI Etapa 1, spec §4.6) sobre base-ui Tabs: roles y teclas ARIA de fábrica
 * (las flechas cambian de pestaña). `conservarMontadas`: las otras quedan ocultas y no
 * se desmontan (Facturas no pierde lo marcado); sin ella, volver a una pestaña la
 * empieza limpia (Peticiones).
 */
export function Pestanas({
  pestanas,
  valorInicial,
  conservarMontadas = false,
  etiqueta,
  className,
}: {
  pestanas: Pestana[];
  valorInicial?: string;
  conservarMontadas?: boolean;
  etiqueta?: string;
  className?: string;
}) {
  return (
    <Tabs.Root defaultValue={valorInicial ?? pestanas[0]?.valor} className={cn("flex flex-col gap-4", className)}>
      <Tabs.List activateOnFocus aria-label={etiqueta} className="flex gap-1 border-b">
        {pestanas.map((p) => (
          <Tabs.Tab
            key={p.valor}
            value={p.valor}
            className="-mb-px rounded-t-[7px] border-b-2 border-transparent px-3 py-2 text-sm font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-sucursal data-[active]:border-sucursal data-[active]:text-foreground"
          >
            {p.etiqueta}
          </Tabs.Tab>
        ))}
      </Tabs.List>
      {pestanas.map((p) => (
        <Tabs.Panel key={p.valor} value={p.valor} keepMounted={conservarMontadas} className="outline-none">
          {p.contenido}
        </Tabs.Panel>
      ))}
    </Tabs.Root>
  );
}
