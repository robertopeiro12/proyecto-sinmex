import type { ReactNode } from "react";
import { Suspense } from "react";
import { AuthProvider } from "@/components/auth/auth-provider";
import { MarcoPortal } from "@/components/layout/marco-portal";

export default function PortalLayout({ children }: { children: ReactNode }) {
  return (
    // El AuthProvider va DENTRO del Suspense: el marco lee ?sucursal= (useSearchParams) y Next
    // pide un Suspense para las páginas estáticas. Si el proveedor quedara afuera, al hidratar
    // la sesión ya estaría resuelta y el cliente pintaría distinto que el servidor (error de
    // hidratación). Así proveedor y pantallas hidratan juntos, empezando sin usuario.
    <Suspense fallback={null}>
      <AuthProvider>
        <MarcoPortal>{children}</MarcoPortal>
      </AuthProvider>
    </Suspense>
  );
}
