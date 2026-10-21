"use client";

import { Menu as IconoMenu } from "lucide-react";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type CSSProperties, type RefObject, type ReactNode } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { guardarLocal, leerLocal } from "@/lib/almacen-local";
import { iniciales } from "@/lib/formato";
import { cn } from "@/lib/utils";
import { BloqueSucursal } from "./bloque-sucursal";
import { BloqueUsuario } from "./bloque-usuario";
import { tituloDePestana } from "./nav-config";
import { SeccionesMenu } from "./secciones-menu";
import { useSucursalActual } from "./use-sucursal-actual";

export const CLAVE_MENU_ESCONDIDO = "jawa.menu.escondido";

function BotonMenu({ etiqueta, onClick, boton }: { etiqueta: string; onClick: () => void; boton: RefObject<HTMLButtonElement | null> }) {
  return (
    <button
      ref={boton}
      type="button"
      aria-label={etiqueta}
      title={etiqueta}
      onClick={onClick}
      className="grid size-8 place-items-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-sucursal"
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
  // Hasta leer lo guardado el menú no se anima: si venía escondido no debe encogerse en cada carga.
  const [animar, setAnimar] = useState(false);

  useEffect(() => {
    setEscondido(leerLocal(CLAVE_MENU_ESCONDIDO) === "1");
    const cuadro = requestAnimationFrame(() => setAnimar(true));
    return () => cancelAnimationFrame(cuadro);
  }, []);

  // El botón ☰ que se ve tras el cambio es otro (el anterior se desmonta): el foco pasa a él.
  const botonMenu = useRef<HTMLButtonElement>(null);
  const moverFoco = useRef(false);
  useEffect(() => {
    if (moverFoco.current) {
      moverFoco.current = false;
      botonMenu.current?.focus();
    }
  }, [escondido]);

  function alternarMenu() {
    moverFoco.current = true;
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
      {/* Un solo <aside> para los dos estados: su ancho cambia suave (256 ↔ 60 px) y lo de
          adentro entra con un desvanecido. Cada contenido tiene su ancho fijo y el aside lo
          recorta mientras crece o se encoge, así el texto no se reacomoda a medio camino. */}
      <aside
        aria-label={escondido ? "Menú escondido" : undefined}
        className={cn(
          "sticky top-0 h-dvh shrink-0 overflow-hidden border-r bg-menu",
          animar && "transition-[width] duration-200 ease-out",
          escondido ? "w-[60px]" : "w-64",
        )}
      >
        {escondido ? (
          <div key="franja" className="flex h-full w-[60px] animate-in flex-col items-center gap-3 py-3.5 fade-in duration-200">
            <BotonMenu etiqueta="Mostrar menú" onClick={alternarMenu} boton={botonMenu} />
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
          </div>
        ) : (
          <div key="menu" className="flex h-full w-64 animate-in flex-col fade-in duration-200">
            <div className="flex items-center justify-between px-4 pt-4 pb-3">
              <span className="font-titulo text-xl font-bold">JAWA</span>
              <BotonMenu etiqueta="Esconder menú" onClick={alternarMenu} boton={botonMenu} />
            </div>
            <BloqueSucursal sucursal={sucursal} />
            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
              <SeccionesMenu pathname={pathname} sucursal={params.get("sucursal")} />
            </div>
            <BloqueUsuario usuario={usuario} onCerrarSesion={() => void cerrarSesion()} />
          </div>
        )}
      </aside>
      <main className="min-w-0 flex-1 border-t-[3px] border-sucursal px-8 py-7">{children}</main>
    </div>
  );
}
