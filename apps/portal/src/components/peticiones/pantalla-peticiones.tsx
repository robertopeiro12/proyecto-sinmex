"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/components/auth/auth-provider";
import { BandejaPeticiones } from "./bandeja-peticiones";

type Pestana = "pendiente" | "historial";

/** Operación → Peticiones (T-34): autorizar o denegar el borrado de pagos. */
export function PantallaPeticiones({ sucursal }: { sucursal: string | null }) {
  const { puede } = useAuth();
  const [pestana, setPestana] = useState<Pestana>("pendiente");

  if (!puede("peticiones.gestionar")) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Peticiones</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No tienes permiso para ver peticiones</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Peticiones</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex gap-2">
          <Button
            type="button"
            variant={pestana === "pendiente" ? "default" : "outline"}
            aria-pressed={pestana === "pendiente"}
            onClick={() => setPestana("pendiente")}
          >
            Pendientes
          </Button>
          <Button
            type="button"
            variant={pestana === "historial" ? "default" : "outline"}
            aria-pressed={pestana === "historial"}
            onClick={() => setPestana("historial")}
          >
            Historial
          </Button>
        </div>
        {/* key: cambiar de pestaña empieza limpio (sin avisos ni paneles de la otra). */}
        <BandejaPeticiones key={pestana} status={pestana} sucursal={sucursal} />
      </CardContent>
    </Card>
  );
}
