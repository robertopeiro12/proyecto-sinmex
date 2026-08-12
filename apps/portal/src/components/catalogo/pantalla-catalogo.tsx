"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/components/auth/auth-provider";
import { TablaCatalogo, type Columna } from "./tabla-catalogo";
import { useCatalogo } from "./use-catalogo";

interface Props<T> {
  titulo: string;
  /** Clave que habilita alta y edicion, p.ej. "producto.gestionar". */
  permiso: string;
  etiquetaAlta: string;
  vacio: string;
  mensajeError: string;
  cargar: () => Promise<T[]>;
  columnas: Columna<T>[];
  formulario: (
    item: T | null,
    alGuardar: () => void,
    alCancelar: () => void,
  ) => ReactNode;
  /** Recarga cuando algo de aqui cambie. Ver useCatalogo. */
  deps?: unknown[];
}

/**
 * El envoltorio que arma una pantalla de catalogo entera. Por dentro son
 * piezas sueltas (useCatalogo + TablaCatalogo) a proposito: T-12 Clientes
 * probablemente no quepa aqui —lleva filtros, lista de precios, promocion y
 * credito— y cuando pase, baja al hook sin tener que inflar este componente
 * con props que solo usa el, ni duplicar la logica (D9).
 */
export function PantallaCatalogo<T extends { id: string }>({
  titulo,
  permiso,
  etiquetaAlta,
  vacio,
  mensajeError,
  cargar,
  columnas,
  formulario,
  deps = [],
}: Props<T>) {
  const { puede } = useAuth();
  const puedeGestionar = puede(permiso);
  const catalogo = useCatalogo<T>(cargar, { mensajeError, deps });

  const alGuardar = () => {
    catalogo.cerrar();
    void catalogo.recargar();
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>{titulo}</CardTitle>
        {puedeGestionar && (
          <Button
            size="sm"
            disabled={catalogo.edicion !== null}
            onClick={catalogo.abrirAlta}
          >
            {etiquetaAlta}
          </Button>
        )}
      </CardHeader>

      <CardContent>
        {catalogo.edicion !== null && (
          <div
            // Sin `key` React reutiliza la misma instancia del formulario al
            // pasar de "editar A" a "editar B": sus useState solo leen el prop
            // en el primer montaje, asi que los campos se quedarian con los
            // valores viejos de A. Lo descubrio T-09 y aqui se hereda para las
            // cuatro pantallas.
            key={catalogo.edicion === "nueva" ? "nueva" : catalogo.edicion.id}
          >
            {formulario(
              catalogo.edicion === "nueva" ? null : catalogo.edicion,
              alGuardar,
              catalogo.cerrar,
            )}
          </div>
        )}

        {catalogo.cargando && <p className="text-muted-foreground">Cargando…</p>}

        {catalogo.error && (
          <p role="alert" className="text-sm text-destructive">
            {catalogo.error}
          </p>
        )}

        {!catalogo.cargando && !catalogo.error && (
          <TablaCatalogo
            items={catalogo.items}
            columnas={columnas}
            vacio={vacio}
            acciones={
              puedeGestionar
                ? (item) => (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={catalogo.edicion !== null}
                      onClick={() => catalogo.abrirEdicion(item)}
                    >
                      Editar
                    </Button>
                  )
                : undefined
            }
          />
        )}
      </CardContent>
    </Card>
  );
}
