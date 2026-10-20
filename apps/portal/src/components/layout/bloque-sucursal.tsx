"use client";

import { Menu } from "@base-ui/react/menu";
import { Check, ChevronDown } from "lucide-react";
import { colorDeSucursal } from "@/lib/sucursal-color";
import { cn } from "@/lib/utils";
import { NOMBRE_TODAS, type SucursalActual } from "./use-sucursal-actual";

const TODAS = "todas";

const CLASE_BLOQUE =
  "mx-3 mb-3 flex items-end justify-between gap-2 rounded-[10px] bg-sucursal px-3 pt-2.5 pb-3 text-left text-white";

/**
 * La sucursal en grande, en su color (UI Etapa 1, spec §3.2). Quien puede elegir abre
 * la lista; un usuario atado solo ve la suya, sin flecha.
 */
export function BloqueSucursal({ sucursal }: { sucursal: SucursalActual }) {
  const contenido = (
    <span className="flex min-w-0 flex-col">
      <span className="text-xs opacity-80">Sucursal</span>
      <span className="truncate font-titulo text-[22px] leading-tight font-bold">{sucursal.nombre}</span>
    </span>
  );

  if (!sucursal.puedeElegir) return <div className={CLASE_BLOQUE}>{contenido}</div>;

  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label={`Sucursal: ${sucursal.nombre}. Cambiar de sucursal`}
        className={cn(
          CLASE_BLOQUE,
          "w-[calc(100%-1.5rem)] cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-sucursal focus-visible:ring-offset-2",
        )}
      >
        {contenido}
        <ChevronDown aria-hidden className="mb-1 size-4 shrink-0" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="bottom" align="start" sideOffset={6} className="z-50">
          <Menu.Popup className="w-[232px] rounded-[10px] border bg-background p-1.5 text-sm shadow-[0_12px_30px_rgb(0_0_0/0.15)] outline-none">
            <Menu.RadioGroup
              value={sucursal.codigo ?? TODAS}
              onValueChange={(valor) => sucursal.elegir(valor === TODAS ? null : String(valor))}
            >
              <Opcion valor={TODAS} nombre={NOMBRE_TODAS} color={colorDeSucursal(null)} />
              {sucursal.opciones.map((s) => (
                <Opcion key={s.id} valor={s.codigo} nombre={s.nombre} color={colorDeSucursal(s.codigo)} />
              ))}
            </Menu.RadioGroup>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

function Opcion({ valor, nombre, color }: { valor: string; nombre: string; color: string }) {
  return (
    <Menu.RadioItem
      value={valor}
      closeOnClick
      className="flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 outline-none data-[highlighted]:bg-menu"
    >
      <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
      <span className="flex-1">{nombre}</span>
      <Menu.RadioItemIndicator>
        <Check aria-hidden className="size-4" />
      </Menu.RadioItemIndicator>
    </Menu.RadioItem>
  );
}
