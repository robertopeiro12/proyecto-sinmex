"use client";

import { Menu as IconoMenu } from "lucide-react";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { guardarLocal, leerLocal } from "@/lib/almacen-local";
import { iniciales } from "@/lib/formato";
import { BloqueSucursal } from "./bloque-sucursal";
import { BloqueUsuario } from "./bloque-usuario";
import { tituloDePestana } from "./nav-config";
import { SeccionesMenu } from "./secciones-menu";
import { useSucursalActual } from "./use-sucursal-actual";

export const CLAVE_MENU_ESCONDIDO = "jawa.menu.escondido";

function BotonMenu({ etiqueta, onClick }: { etiqueta: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={etiqueta}
      title={etiqueta}
      onClick={onClick}
      className="grid size-8 place-items-center rounded-md text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-sucursal/40"
    >
      <IconoMenu aria-hidden className="size-4" />
    </button>
  );
}

/**
 * El marco de todas las pantallas (UI Etapa 1, spec §3): el menú lateral ocupa el alto
 * de la ventana y no se mueve al bajar por una tabla; el contenido lleva `min-w-0` para
 * que una tabla ancha se desplace dentro de su caja y no empuje la página. El color de
 * la sucursal (`--suc`) se fija aquí para todo lo de adentro.
 */
export function MarcoPortal({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const { usuario, cerrarSesion } = useAuth();
  const sucursal = useSucursalActual();
  // En el servidor no hay localStorage: se arranca abierto y se ajusta al montar.
  const [escondido, setEscondido] = useState(false);

  useEffect(() => {
    setEscondido(leerLocal(CLAVE_MENU_ESCONDIDO) === "1");
  }, []);

  function alternarMenu() {
    const nuevo = !escondido;
    setEscondido(nuevo);
    guardarLocal(CLAVE_MENU_ESCONDIDO, nuevo ? "1" : "0");
  }

  const titulo = tituloDePestana(pathname, sucursal.codigo === null ? null : sucursal.nombre);
  const estilo = { "--suc": sucursal.color } as CSSProperties;

  return (
    <div className="flex min-h-dvh" style={estilo}>
      {/* React 19 sube este <title> al <head>; app/layout.tsx ya no fija uno propio. */}
      <title>{titulo}</title>
      {escondido ? (
        <aside
          aria-label="Menú escondido"
          className="sticky top-0 flex h-dvh w-[60px] shrink-0 flex-col items-center gap-3 border-r bg-menu py-3.5"
        >
          <BotonMenu etiqueta="Mostrar menú" onClick={alternarMenu} />
          <span title={sucursal.nombre} className="rounded-md bg-sucursal px-1.5 py-1 text-xs font-bold text-white">
            {sucursal.siglas}
          </span>
          {usuario && (
            <span
              title={usuario.nombre}
              className="mt-auto grid size-[34px] place-items-center rounded-full bg-foreground text-[13px] font-semibold text-background"
            >
              {iniciales(usuario.nombre)}
            </span>
          )}
        </aside>
      ) : (
        <aside className="sticky top-0 flex h-dvh w-64 shrink-0 flex-col border-r bg-menu">
          <div className="flex items-center justify-between px-4 pt-4 pb-3">
            <span className="font-titulo text-xl font-bold">JAWA</span>
            <BotonMenu etiqueta="Esconder menú" onClick={alternarMenu} />
          </div>
          <BloqueSucursal sucursal={sucursal} />
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
            <SeccionesMenu pathname={pathname} sucursal={params.get("sucursal")} />
          </div>
          <BloqueUsuario usuario={usuario} onCerrarSesion={() => void cerrarSesion()} />
        </aside>
      )}
      <main className="min-w-0 flex-1 border-t-[3px] border-sucursal px-8 py-7">{children}</main>
    </div>
  );
}
