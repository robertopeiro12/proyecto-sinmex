"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormularioSucursal } from "./formulario-sucursal";
import { listarSucursales, type Sucursal } from "@/lib/sucursales";

/** null = formulario cerrado · "nueva" = alta · una Sucursal = edicion. */
type Edicion = Sucursal | "nueva" | null;

export function PantallaSucursales({ sucursal }: { sucursal: string | null }) {
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [edicion, setEdicion] = useState<Edicion>(null);

  const recargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      setSucursales(await listarSucursales(sucursal));
    } catch {
      // Un 401 aqui ya lo maneja apiFetch (refresca) y AuthProvider (rebota al
      // login). Lo que queda son fallos de red o 5xx, y para esos lo unico
      // honesto es decir que no se pudo cargar.
      setError("No se pudieron cargar las sucursales.");
    } finally {
      setCargando(false);
    }
  }, [sucursal]);

  useEffect(() => {
    void recargar();
  }, [recargar]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Sucursales</CardTitle>
        {edicion === null && (
          <Button size="sm" onClick={() => setEdicion("nueva")}>
            Nueva sucursal
          </Button>
        )}
      </CardHeader>

      <CardContent>
        {edicion !== null && (
          <FormularioSucursal
            sucursal={edicion === "nueva" ? null : edicion}
            alGuardar={() => {
              setEdicion(null);
              void recargar();
            }}
            alCancelar={() => setEdicion(null)}
          />
        )}

        {cargando && <p className="text-muted-foreground">Cargando…</p>}

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        {!cargando && !error && (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 font-medium">Código</th>
                <th className="py-2 font-medium">Nombre</th>
                <th className="py-2 font-medium">Estado</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {sucursales.map((s) => (
                <tr key={s.id} className="border-b last:border-0">
                  <td className="py-2 font-mono">{s.codigo}</td>
                  <td className="py-2">{s.nombre}</td>
                  <td className="py-2">
                    {s.activa ? (
                      "Activa"
                    ) : (
                      <span className="text-muted-foreground">Inactiva</span>
                    )}
                  </td>
                  <td className="py-2 text-right">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setEdicion(s)}
                    >
                      Editar
                    </Button>
                  </td>
                </tr>
              ))}
              {sucursales.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-4 text-muted-foreground">
                    No hay sucursales que mostrar.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}
