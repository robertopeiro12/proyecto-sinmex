"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/components/auth/auth-provider";
import { TablaCatalogo } from "@/components/catalogo/tabla-catalogo";
import { useCatalogo } from "@/components/catalogo/use-catalogo";
import { mensajeDe } from "@/lib/api";
import {
  eliminarCampoEgreso,
  ETIQUETA_TIPO_EGRESO,
  listarCamposEgreso,
  PERMISO_CAMPOS_EGRESO,
  type CampoEgreso,
} from "@/lib/campos-egreso";
import { FormularioCampoEgreso } from "./formulario-campo-egreso";

const siNo = (valor: boolean) => (valor ? "Sí" : "No");

/**
 * Catálogo › Campos de egreso (T-30, D3): en qué se gasta el dinero (gasolina, hielo, envases…). Leer pide
 * sesión; dar de alta, editar y dar de baja (lógica, con confirmación) pide `campo_egreso.gestionar`. Mismo
 * patrón que Motivos de visita (T-39). La baja la rechaza el servidor con 409 si el campo tiene gastos este
 * año; el motivo se muestra tal cual.
 */
export function PantallaCamposEgreso() {
  const { puede } = useAuth();
  const puedeGestionar = puede(PERMISO_CAMPOS_EGRESO);
  const catalogo = useCatalogo<CampoEgreso>(() => listarCamposEgreso(), {
    mensajeError: "No se pudieron cargar los campos de egreso.",
  });
  const [eliminando, setEliminando] = useState<string | null>(null);
  const [errorAccion, setErrorAccion] = useState<string | null>(null);
  const ocupado = catalogo.edicion !== null || eliminando !== null;

  async function eliminar(c: CampoEgreso) {
    if (
      !window.confirm(
        `¿Seguro que quieres eliminar el campo "${c.nombre}"? Los gastos ya registrados lo conservan, pero las tablets dejarán de ofrecerlo.`,
      )
    )
      return;
    setEliminando(c.id);
    setErrorAccion(null);
    try {
      await eliminarCampoEgreso(c.id);
      void catalogo.recargar();
    } catch (err) {
      setErrorAccion(mensajeDe(err, "No se pudo eliminar el campo."));
    } finally {
      setEliminando(null);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Campos de egreso</CardTitle>
        {puedeGestionar && (
          <Button size="sm" disabled={ocupado} onClick={catalogo.abrirAlta}>
            Nuevo campo
          </Button>
        )}
      </CardHeader>

      <CardContent>
        {catalogo.edicion !== null && (
          <div key={catalogo.edicion === "nueva" ? "nueva" : catalogo.edicion.id}>
            <FormularioCampoEgreso
              campo={catalogo.edicion === "nueva" ? null : catalogo.edicion}
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
            vacio="Todavía no hay campos de egreso. Da de alta el primero."
            columnas={[
              { encabezado: "Nombre", celda: (c) => c.nombre },
              { encabezado: "Tipo", celda: (c) => ETIQUETA_TIPO_EGRESO[c.tipo], className: "whitespace-nowrap" },
              { encabezado: "Se usa en la app", celda: (c) => siNo(c.seUsaEnApp), className: "whitespace-nowrap" },
            ]}
            acciones={
              puedeGestionar
                ? (c) => (
                    <div className="flex justify-end gap-2">
                      <Button variant="outline" size="sm" disabled={ocupado} onClick={() => catalogo.abrirEdicion(c)}>
                        Editar
                      </Button>
                      <Button variant="outline" size="sm" disabled={ocupado} onClick={() => void eliminar(c)}>
                        {eliminando === c.id ? "Eliminando…" : "Eliminar"}
                      </Button>
                    </div>
                  )
                : undefined
            }
          />
        )}
      </CardContent>
    </Card>
  );
}
