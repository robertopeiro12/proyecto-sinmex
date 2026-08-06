"use client";

import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/components/auth/auth-provider";
import { SelectorSucursal } from "./selector-sucursal";

export function BarraUsuario() {
  const { usuario, cargando, cerrarSesion } = useAuth();

  if (cargando || !usuario) {
    return <div className="h-9" />;
  }

  return (
    <div className="flex items-center justify-end gap-3 border-b pb-3 text-sm">
      <Suspense fallback={<span className="text-muted-foreground">…</span>}>
        <SelectorSucursal />
      </Suspense>
      <span className="mx-1 text-muted-foreground">|</span>
      <span className="font-medium">{usuario.nombre}</span>
      <span className="text-muted-foreground">
        {usuario.perfil} · {usuario.sucursal?.codigo ?? "General"}
      </span>
      <Button variant="outline" size="sm" onClick={() => void cerrarSesion()}>
        Salir
      </Button>
    </div>
  );
}
