"use client";

import { Menu } from "@base-ui/react/menu";
import { ChevronsUpDown, LogOut } from "lucide-react";
import type { UsuarioSesion } from "@/lib/api";
import { iniciales } from "@/lib/formato";

/**
 * El usuario abajo del menú (UI Etapa 1, spec §3.4): iniciales, nombre y perfil. Sin el
 * código "General" ni el de sucursal (la sucursal ya está arriba). "Cerrar sesión" vive
 * en un menú pequeño: salir deja de estar a la vista todo el tiempo.
 */
export function BloqueUsuario({
  usuario,
  onCerrarSesion,
}: {
  usuario: UsuarioSesion | null;
  onCerrarSesion: () => void;
}) {
  if (!usuario) return <div aria-hidden className="h-[59px] shrink-0 border-t" />;

  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label={`${usuario.nombre}, ${usuario.perfil}. Abrir opciones`}
        className="flex w-full shrink-0 items-center gap-2.5 border-t px-3 py-3 text-left outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-sucursal focus-visible:ring-inset"
      >
        <span
          aria-hidden
          className="grid size-[34px] shrink-0 place-items-center rounded-full bg-foreground text-[13px] font-semibold text-background"
        >
          {iniciales(usuario.nombre)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{usuario.nombre}</span>
          <span className="block truncate text-xs text-muted-foreground">{usuario.perfil}</span>
        </span>
        <ChevronsUpDown aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="top" align="start" sideOffset={6} className="z-50">
          <Menu.Popup className="w-[232px] rounded-[10px] border bg-background p-1.5 text-sm shadow-[0_12px_30px_rgb(0_0_0/0.15)] outline-none">
            <Menu.Item
              onClick={onCerrarSesion}
              className="flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 outline-none data-[highlighted]:bg-menu"
            >
              <LogOut aria-hidden className="size-4" />
              Cerrar sesión
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
