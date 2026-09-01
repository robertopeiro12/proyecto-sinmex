"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/components/auth/auth-provider";
import { useCatalogo } from "@/components/catalogo/use-catalogo";
import { TablaCatalogo } from "@/components/catalogo/tabla-catalogo";
import {
  eliminarCliente,
  listarClientes,
  obtenerCliente,
  type ClienteDetalle,
  type ClienteResumen,
  type TipoFiltro,
} from "@/lib/clientes";
import { FormularioCliente } from "./formulario-cliente";
import { FiltroTipo } from "./filtro-tipo";

type Edicion = "nueva" | ClienteDetalle | null;

/**
 * No usa PantallaCatalogo (D3 del spec): editar necesita el DETALLE completo
 * (overrides + promocion), que no viaja en la fila de la lista -- se pide
 * aparte con `obtenerCliente()` al abrir el formulario. `PantallaCatalogo`
 * asume que el item de la lista y el item del formulario son el mismo tipo.
 */
export function PantallaClientes({
  sucursal,
  tipo,
}: {
  sucursal: string | null;
  tipo: TipoFiltro;
}) {
  const { puede } = useAuth();
  const puedeGestionar = puede("cliente.gestionar");
  const catalogo = useCatalogo<ClienteResumen>(
    () => listarClientes(sucursal, tipo),
    { mensajeError: "No se pudieron cargar los clientes.", deps: [sucursal, tipo] },
  );

  const [edicion, setEdicion] = useState<Edicion>(null);
  const [cargandoDetalleId, setCargandoDetalleId] = useState<string | null>(null);
  const [eliminandoId, setEliminandoId] = useState<string | null>(null);
  const [errorDetalle, setErrorDetalle] = useState<string | null>(null);

  async function abrirEdicion(resumen: ClienteResumen) {
    setCargandoDetalleId(resumen.id);
    setErrorDetalle(null);
    try {
      setEdicion(await obtenerCliente(resumen.id));
    } catch {
      setErrorDetalle("No se pudo cargar el detalle de ese cliente.");
    } finally {
      setCargandoDetalleId(null);
    }
  }

  function cerrar() {
    setEdicion(null);
  }

  function alGuardar() {
    cerrar();
    void catalogo.recargar();
  }

  async function eliminar(item: ClienteResumen) {
    if (!window.confirm(`¿Dar de baja a "${item.nombre}"? Se conserva su historial.`)) {
      return;
    }
    setEliminandoId(item.id);
    setErrorDetalle(null);
    try {
      await eliminarCliente(item.id);
      void catalogo.recargar();
    } catch {
      setErrorDetalle("No se pudo dar de baja ese cliente.");
    } finally {
      setEliminandoId(null);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div className="flex items-center gap-3">
          <CardTitle>Clientes</CardTitle>
          <FiltroTipo valor={tipo} />
        </div>
        {puedeGestionar && (
          <Button
            size="sm"
            disabled={edicion !== null || cargandoDetalleId !== null || eliminandoId !== null}
            onClick={() => setEdicion("nueva")}
          >
            Nuevo cliente
          </Button>
        )}
      </CardHeader>

      <CardContent>
        {edicion !== null && (
          <div key={edicion === "nueva" ? "nueva" : edicion.id}>
            <FormularioCliente
              cliente={edicion === "nueva" ? null : edicion}
              alGuardar={alGuardar}
              alCancelar={cerrar}
            />
          </div>
        )}

        {errorDetalle && (
          <p role="alert" className="mb-4 text-sm text-destructive">
            {errorDetalle}
          </p>
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
            vacio="No hay clientes que mostrar."
            columnas={[
              { encabezado: "Nombre", celda: (c) => c.nombre },
              { encabezado: "Teléfono", celda: (c) => c.telefono },
              {
                encabezado: "Tipo",
                celda: (c) => (c.tipo === "cliente" ? "Cliente" : "Prospecto"),
              },
              { encabezado: "Tipo de negocio", celda: (c) => c.tipoNegocio ?? "—" },
              {
                encabezado: "Sucursal",
                celda: (c) => c.sucursalCodigo,
                className: "font-mono",
              },
            ]}
            acciones={
              puedeGestionar
                ? (c) => (
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={
                          edicion !== null ||
                          cargandoDetalleId !== null ||
                          eliminandoId !== null
                        }
                        onClick={() => void abrirEdicion(c)}
                      >
                        {cargandoDetalleId === c.id ? "Cargando…" : "Editar"}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={
                          edicion !== null ||
                          cargandoDetalleId !== null ||
                          eliminandoId !== null
                        }
                        onClick={() => void eliminar(c)}
                      >
                        {eliminandoId === c.id ? "Eliminando…" : "Eliminar"}
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
