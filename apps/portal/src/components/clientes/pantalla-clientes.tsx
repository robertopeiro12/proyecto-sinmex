"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Aviso } from "@/components/ui/aviso";
import { useConfirmar } from "@/components/ui/confirmar";
import { EncabezadoPantalla, Pantalla } from "@/components/ui/encabezado-pantalla";
import { EstadoPantalla } from "@/components/ui/estado-pantalla";
import { CajaTabla } from "@/components/ui/tabla";
import { ErrorApi } from "@/lib/api";
import { useAuth } from "@/components/auth/auth-provider";
import { useCatalogo } from "@/components/catalogo/use-catalogo";
import { TablaCatalogo } from "@/components/catalogo/tabla-catalogo";
import {
  convertirACliente,
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
 * (overrides de precio), que no viaja en la fila de la lista -- se pide
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

  const { confirmar, ventana } = useConfirmar();
  const [edicion, setEdicion] = useState<Edicion>(null);
  const [cargandoDetalleId, setCargandoDetalleId] = useState<string | null>(null);
  const [eliminandoId, setEliminandoId] = useState<string | null>(null);
  const [convirtiendoId, setConvirtiendoId] = useState<string | null>(null);
  const [errorDetalle, setErrorDetalle] = useState<string | null>(null);
  const enCurso =
    edicion !== null ||
    cargandoDetalleId !== null ||
    eliminandoId !== null ||
    convirtiendoId !== null;

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
    const si = await confirmar({
      titulo: `¿Dar de baja a "${item.nombre}"?`,
      descripcion: "Se conserva su historial.",
      confirmar: "Dar de baja",
    });
    if (!si) return;
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

  async function convertir(item: ClienteResumen) {
    const si = await confirmar({
      titulo: `¿Convertir a "${item.nombre}" en Cliente?`,
      descripcion: "No se puede deshacer.",
      confirmar: "Convertir en cliente",
    });
    if (!si) return;
    setConvirtiendoId(item.id);
    setErrorDetalle(null);
    try {
      await convertirACliente(item.id);
      void catalogo.recargar();
    } catch (err) {
      // Aqui SI se muestra el mensaje exacto del servidor (ErrorApi.mensajeApi):
      // el 409 de la conversion dice QUE le falta al prospecto (domicilio,
      // lista de precios, encargado) y solo el servidor lo sabe (T-70).
      setErrorDetalle(
        err instanceof ErrorApi && err.mensajeApi
          ? err.mensajeApi
          : "No se pudo convertir ese prospecto en cliente.",
      );
    } finally {
      setConvirtiendoId(null);
    }
  }

  if (edicion !== null) {
    return (
      <Pantalla>
        <Button variant="ghost" className="self-start" onClick={cerrar}>
          ← Volver a clientes
        </Button>
        <EncabezadoPantalla
          titulo={edicion === "nueva" ? "Nuevo cliente" : `Editar ${edicion.nombre}`}
        />
        <div key={edicion === "nueva" ? "nueva" : edicion.id} className="flex flex-col gap-6">
          <FormularioCliente
            cliente={edicion === "nueva" ? null : edicion}
            alGuardar={alGuardar}
            alCancelar={cerrar}
          />
        </div>
        {ventana}
      </Pantalla>
    );
  }

  const error = catalogo.error ?? errorDetalle;

  return (
    <Pantalla>
      <EncabezadoPantalla
        titulo="Clientes"
        descripcion="Los clientes y prospectos de la sucursal: datos, ubicación, precios y promociones."
        acciones={
          <>
            <FiltroTipo valor={tipo} />
            {puedeGestionar && (
              <Button disabled={enCurso} onClick={() => setEdicion("nueva")}>
                Nuevo cliente
              </Button>
            )}
          </>
        }
      />

      {error && <Aviso tono="error">{error}</Aviso>}

      {catalogo.cargando && <EstadoPantalla tipo="cargando" />}

      {!catalogo.cargando && !catalogo.error && (
        <CajaTabla>
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
                      {c.tipo === "prospecto" && (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={enCurso}
                          onClick={() => void convertir(c)}
                        >
                          {convirtiendoId === c.id ? "Convirtiendo…" : "Convertir a Cliente"}
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={enCurso}
                        onClick={() => void abrirEdicion(c)}
                      >
                        {cargandoDetalleId === c.id ? "Cargando…" : "Editar"}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={enCurso}
                        onClick={() => void eliminar(c)}
                      >
                        {eliminandoId === c.id ? "Eliminando…" : "Eliminar"}
                      </Button>
                    </div>
                  )
                : undefined
            }
          />
        </CajaTabla>
      )}

      {ventana}
    </Pantalla>
  );
}
