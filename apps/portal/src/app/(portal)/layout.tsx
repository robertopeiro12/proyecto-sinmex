import type { ReactNode } from "react";
import { AuthProvider } from "@/components/auth/auth-provider";
import { BarraUsuario } from "@/components/layout/barra-usuario";
import { SidebarNav } from "@/components/layout/sidebar-nav";

export default function PortalLayout({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <div className="flex min-h-screen">
        <aside className="w-64 shrink-0 border-r bg-background p-4">
          <div className="mb-6 px-3 text-lg font-bold">JAWA</div>
          <SidebarNav />
        </aside>
        <main className="flex-1 p-8">
          <BarraUsuario />
          <div className="pt-6">{children}</div>
        </main>
      </div>
    </AuthProvider>
  );
}
