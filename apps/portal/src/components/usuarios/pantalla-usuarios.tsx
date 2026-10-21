"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Aviso } from "@/components/ui/aviso";
import { useConfirmar } from "@/components/ui/confirmar";
import { EncabezadoPantalla, Pantalla } from "@/components/ui/encabezado-pantalla";
import { CajaTabla } from "@/components/ui/tabla";
import { useAuth } from "@/components/auth/auth-provider";
import { useCatalogo } from "@/components/catalogo/use-catalogo";
import { TablaCatalogo } from "@/components/catalogo/tabla-catalogo";
import { EstadoPantalla } from "@/components/ui/estado-pantalla";
import { ErrorApi } from "@/lib/api";
import {
  eliminarUsuario,
  listarUsuarios,
  obtenerUsuario,
  type UsuarioDetalle,
  type UsuarioResumen,
} from "@/lib/usuarios";
import { FormularioUsuario } from "./formulario-usuario";

type Edicion = "nueva" | UsuarioDetalle | null;

/**
 * D6 del spec: usuario.gestionar gatea tambien la LECTURA, igual que
 * PantallaPerfiles (T-08b) -- ni siquiera se intenta el GET sin el
 * permiso, se espera a que la sesion termine de cargar antes de decidir
 * (mismo motivo documentado ahi: `puede()` da `false` de entrada mientras
 * `usuario` sigue en null).
 */
export function PantallaUsuarios({ sucursal }: { sucursal: string | null }) {
  const { puede, cargando: cargandoSesion } = useAuth();

  if (cargandoSesion) {
    return <EstadoPantalla titulo="Usuarios" tipo="cargando" />;
  }
  if (!puede("usuario.gestionar")) {
    return <EstadoPantalla titulo="Usuarios" tipo="sin-permiso" />;
  }
  return <Tabla sucursal={sucursal} />;
}

/**
 * Sin `puede()` por boton (a diferencia de PantallaClientes): la pantalla
 * ENTERA ya exige usuario.gestionar arriba, asi que si `Tabla` se esta
 * renderizando es porque quien mira ya puede gestionar -- mismo criterio
 * que PantallaPerfiles (T-08b).
 */
function Tabla({ sucursal }: { sucursal: string | null }) {
  const catalogo = useCatalogo<UsuarioResumen>(() => listarUsuarios(sucursal), {
    mensajeError: "No se pudieron cargar los usuarios.",
    deps: [sucursal],
  });

  const { confirmar, ventana } = useConfirmar();
  const [edicion, setEdicion] = useState<Edicion>(null);
  const [cargandoDetalleId, setCargandoDetalleId] = useState<string | null>(null);
  const [eliminandoId, setEliminandoId] = useState<string | null>(null);
  const [errorDetalle, setErrorDetalle] = useState<string | null>(null);
  const enCurso = edicion !== null || cargandoDetalleId !== null || eliminandoId !== null;

  async function abrirEdicion(resumen: UsuarioResumen) {
    setCargandoDetalleId(resumen.id);
    setErrorDetalle(null);
    try {
      setEdicion(await obtenerUsuario(resumen.id));
    } catch {
      setErrorDetalle("No se pudo cargar el detalle de ese usuario.");
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

  async function eliminar(item: UsuarioResumen) {
    const si = await confirmar({
      titulo: `¿Dar de baja a "${item.nombre}"?`,
      descripcion: "Ya no podrá entrar al portal.",
      confirmar: "Dar de baja",
    });
    if (!si) return;
    setEliminandoId(item.id);
    setErrorDetalle(null);
    try {
      await eliminarUsuario(item.id);
      void catalogo.recargar();
    } catch (err) {
      // A diferencia de la mayoria de las pantallas (PantallaClientes solo lo
      // hace al convertir un prospecto): aqui SI vale la pena mostrar el
      // mensaje exacto del servidor (ErrorApi.mensajeApi) -- las dos
      // protecciones de D7 ("no puedes dar de baja tu propio usuario",
      // "debe quedar al menos un Administrador General activo") son
      // exactamente el tipo de error que solo el servidor sabe explicar
      // (doc de ErrorApi en lib/api.ts).
      setErrorDetalle(
        err instanceof ErrorApi && err.mensajeApi
          ? err.mensajeApi
          : "No se pudo dar de baja ese usuario.",
      );
    } finally {
      setEliminandoId(null);
    }
  }

  if (edicion !== null) {
    return (
      <Pantalla key="formulario">
        <Button variant="ghost" className="self-start" onClick={cerrar}>
          ← Volver a usuarios
        </Button>
        <EncabezadoPantalla
          titulo={edicion === "nueva" ? "Nuevo usuario" : `Editar ${edicion.nombre}`}
        />
        <div key={edicion === "nueva" ? "nueva" : edicion.id}>
          <FormularioUsuario
            usuario={edicion === "nueva" ? null : edicion}
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
    <Pantalla key="lista">
      <EncabezadoPantalla
        titulo="Usuarios"
        descripcion="Quién entra al portal, con qué perfil y en qué sucursal."
        acciones={
          <Button disabled={enCurso} onClick={() => setEdicion("nueva")}>
            Nuevo usuario
          </Button>
        }
      />

      {error && <Aviso tono="error">{error}</Aviso>}

      {catalogo.cargando && <EstadoPantalla tipo="cargando" />}

      {!catalogo.cargando && !catalogo.error && (
        <CajaTabla>
          <TablaCatalogo
            items={catalogo.items}
            vacio="No hay usuarios que mostrar."
            columnas={[
              { encabezado: "Login", celda: (u) => u.login },
              { encabezado: "Nombre", celda: (u) => u.nombre },
              { encabezado: "Perfil", celda: (u) => u.perfil },
              {
                encabezado: "Sucursal",
                celda: (u) => u.sucursalCodigo ?? "General",
                className: "font-mono",
              },
            ]}
            acciones={(u) => (
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={enCurso}
                  onClick={() => void abrirEdicion(u)}
                >
                  {cargandoDetalleId === u.id ? "Cargando…" : "Editar"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={enCurso}
                  onClick={() => void eliminar(u)}
                >
                  {eliminandoId === u.id ? "Eliminando…" : "Eliminar"}
                </Button>
              </div>
            )}
          />
        </CajaTabla>
      )}
      {ventana}
    </Pantalla>
  );
}
