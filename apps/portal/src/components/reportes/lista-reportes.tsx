"use client";

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/components/auth/auth-provider";

/** Información → Reportes (T-50): la lista. Kilometraje (T-50) y Clientes nuevos (T-51); los demas reportes se suman aqui. */
export function ListaReportes({ sucursal }: { sucursal: string | null }) {
  const { puede, cargando: cargandoSesion } = useAuth();
  const consulta = sucursal ? `?sucursal=${encodeURIComponent(sucursal)}` : "";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Reportes</CardTitle>
      </CardHeader>
      <CardContent>
        {cargandoSesion ? (
          <p className="text-sm text-muted-foreground">Cargando…</p>
        ) : !puede("reportes.ver") ? (
          <p className="text-sm text-muted-foreground">No tienes permiso para ver reportes</p>
        ) : (
          <ul className="flex flex-col gap-3">
            <li>
              <Link href={`/informacion/reportes/kilometraje${consulta}`} className="font-medium underline">
                Kilometraje
              </Link>
              <p className="text-sm text-muted-foreground">
                Kilómetros por vehículo y día, con los saltos entre jornadas. Exportable a Excel.
              </p>
            </li>
            <li>
              <Link href={`/informacion/reportes/clientes-nuevos${consulta}`} className="font-medium underline">
                Clientes nuevos
              </Link>
              <p className="text-sm text-muted-foreground">
                Clientes dados de alta (o convertidos de prospecto) en un rango, con el usuario que los dio de alta. Exportable a Excel.
              </p>
            </li>
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
