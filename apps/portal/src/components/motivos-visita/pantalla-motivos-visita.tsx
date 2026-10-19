"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/components/auth/auth-provider";
import { TablaCatalogo } from "@/components/catalogo/tabla-catalogo";
import { useCatalogo } from "@/components/catalogo/use-catalogo";
import { mensajeDe } from "@/lib/api";
import {
  eliminarMotivoVisita,
  listarMotivosVisita,
  PERMISO_MOTIVOS_VISITA,
  type MotivoVisita,
} from "@/lib/motivos-visita";
import { FormularioMotivoVisita } from "./formulario-motivo-visita";

const siNo = (valor: boolean) => (valor ? "Sí" : "No");

/**
 * Catálogo › Motivos de visita (T-39, D5): por qué un cliente no compró. Leer pide
 * sesión; dar de alta, editar y dar de baja (lógica, con confirmación) pide
 * `motivo_visita.gestionar`. Mismo patrón que la pestaña de cuentas de Tesorería.
 */
export function PantallaMotivosVisita() {
  const { puede } = useAuth();
  const puedeGestionar = puede(PERMISO_MOTIVOS_VISITA);
  const catalogo = useCatalogo<MotivoVisita>(() => listarMotivosVisita(), {
    mensajeError: "No se pudieron cargar los motivos de visita.",
  });
  const [eliminando, setEliminando] = useState<string | null>(null);
  const [errorAccion, setErrorAccion] = useState<string | null>(null);
  const ocupado = catalogo.edicion !== null || eliminando !== null;

  async function eliminar(m: MotivoVisita) {
    if (
      !window.confirm(
        `¿Seguro que quieres eliminar el motivo "${m.nombre}"? Las visitas ya registradas lo conservan, pero las tablets dejarán de ofrecerlo.`,
      )
    )
      return;
    setEliminando(m.id);
    setErrorAccion(null);
    try {
      await eliminarMotivoVisita(m.id);
      void catalogo.recargar();
    } catch (err) {
      setErrorAccion(mensajeDe(err, "No se pudo eliminar el motivo."));
    } finally {
      setEliminando(null);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Motivos de visita</CardTitle>
        {puedeGestionar && (
          <Button size="sm" disabled={ocupado} onClick={catalogo.abrirAlta}>
            Nuevo motivo
          </Button>
        )}
      </CardHeader>

      <CardContent>
        {catalogo.edicion !== null && (
          <div key={catalogo.edicion === "nueva" ? "nueva" : catalogo.edicion.id}>
            <FormularioMotivoVisita
              motivo={catalogo.edicion === "nueva" ? null : catalogo.edicion}
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
            vacio="Todavía no hay motivos de visita. Da de alta el primero."
            columnas={[
              { encabezado: "Motivo", celda: (m) => m.nombre },
              { encabezado: "Exige foto", celda: (m) => siNo(m.exigeFoto), className: "whitespace-nowrap" },
              { encabezado: "Exige nombre", celda: (m) => siNo(m.exigeAtendio), className: "whitespace-nowrap" },
            ]}
            acciones={
              puedeGestionar
                ? (m) => (
                    <div className="flex justify-end gap-2">
                      <Button variant="outline" size="sm" disabled={ocupado} onClick={() => catalogo.abrirEdicion(m)}>
                        Editar
                      </Button>
                      <Button variant="outline" size="sm" disabled={ocupado} onClick={() => void eliminar(m)}>
                        {eliminando === m.id ? "Eliminando…" : "Eliminar"}
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
