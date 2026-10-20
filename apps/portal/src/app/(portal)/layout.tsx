import type { ReactNode } from "react";
import { Suspense } from "react";
import { AuthProvider } from "@/components/auth/auth-provider";
import { MarcoPortal } from "@/components/layout/marco-portal";

export default function PortalLayout({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      {/* El marco lee ?sucursal= (useSearchParams): Next pide un Suspense para las páginas estáticas ("Próximamente"). */}
      <Suspense fallback={null}>
        <MarcoPortal>{children}</MarcoPortal>
      </Suspense>
    </AuthProvider>
  );
}
