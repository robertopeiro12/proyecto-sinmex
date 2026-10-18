"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/components/auth/auth-provider";
import { TablaCatalogo } from "@/components/catalogo/tabla-catalogo";
import { useCatalogo } from "@/components/catalogo/use-catalogo";
import { mensajeDe } from "@/lib/api";
import {
  eliminarCuentaTesoreria,
  etiquetaSucursalCuenta,
  listarCuentasTesoreria,
  type CuentaTesoreria,
} from "@/lib/tesoreria";
import { FormularioCuentaTesoreria } from "./formulario-cuenta-tesoreria";

/** Las cuentas ("campos" del cliente). Alta, renombrar y baja lógica con confirmación. */
export function PestanaCuentas({ sucursal }: { sucursal: string | null }) {
  const { usuario } = useAuth();
  const catalogo = useCatalogo<CuentaTesoreria>(() => listarCuentasTesoreria(sucursal), {
    mensajeError: "No se pudieron cargar las cuentas.",
    deps: [sucursal],
  });
  const [eliminando, setEliminando] = useState<string | null>(null);
  const [errorAccion, setErrorAccion] = useState<string | null>(null);

  // Un usuario atado a una sucursal no administra las generales (spec §3.2).
  const modificable = (c: CuentaTesoreria) => usuario?.sucursal === null || c.sucursalId !== null;

  async function eliminar(c: CuentaTesoreria) {
    if (
      !window.confirm(
        `¿Seguro que quieres eliminar la cuenta "${c.nombre}"? Su historia se conserva, pero ya no aparecerá en la Tesorería.`,
      )
    )
      return;
    setEliminando(c.id);
    setErrorAccion(null);
    try {
      await eliminarCuentaTesoreria(c.id);
      void catalogo.recargar();
    } catch (err) {
      setErrorAccion(mensajeDe(err, "No se pudo eliminar la cuenta."));
    } finally {
      setEliminando(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button size="sm" disabled={catalogo.edicion !== null} onClick={catalogo.abrirAlta}>
          Nueva cuenta
        </Button>
      </div>

      {catalogo.edicion !== null && (
        <div key={catalogo.edicion === "nueva" ? "nueva" : catalogo.edicion.id}>
          <FormularioCuentaTesoreria
            cuenta={catalogo.edicion === "nueva" ? null : catalogo.edicion}
            alGuardar={() => {
              catalogo.cerrar();
              void catalogo.recargar();
            }}
            alCancelar={catalogo.cerrar}
          />
        </div>
      )}

      {catalogo.cargando && <p className="text-muted-foreground">Cargando…</p>}
      {(catalogo.error || errorAccion) && (
        <p role="alert" className="text-sm text-destructive">
          {catalogo.error ?? errorAccion}
        </p>
      )}

      {!catalogo.cargando && !catalogo.error && (
        <TablaCatalogo
          items={catalogo.items}
          vacio="Todavía no hay cuentas. Da de alta la primera (Efectivo, Caja Chica, un banco…)."
          columnas={[
            { encabezado: "Cuenta", celda: (c) => c.nombre },
            {
              encabezado: "Sucursal",
              celda: (c) => etiquetaSucursalCuenta(c.sucursalCodigo),
              className: "whitespace-nowrap",
            },
          ]}
          acciones={(c) =>
            modificable(c) ? (
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={catalogo.edicion !== null || eliminando !== null}
                  onClick={() => catalogo.abrirEdicion(c)}
                >
                  Editar
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={catalogo.edicion !== null || eliminando !== null}
                  onClick={() => void eliminar(c)}
                >
                  {eliminando === c.id ? "Eliminando…" : "Eliminar"}
                </Button>
              </div>
            ) : null
          }
        />
      )}
    </div>
  );
}
