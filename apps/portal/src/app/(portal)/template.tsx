import type { ReactNode } from "react";

/**
 * A diferencia del layout, Next vuelve a montar el template en cada navegación: la
 * pantalla nueva entra con un desvanecido corto en lugar de aparecer de golpe. El menú
 * vive en el layout, así que no se mueve. Sin movimiento si el usuario lo pidió
 * (`prefers-reduced-motion`, en globals.css).
 */
export default function PortalTemplate({ children }: { children: ReactNode }) {
  return <div className="animate-in fade-in slide-in-from-bottom-1 duration-200 ease-out">{children}</div>;
}
