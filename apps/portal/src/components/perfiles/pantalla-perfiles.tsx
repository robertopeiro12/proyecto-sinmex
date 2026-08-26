"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/components/auth/auth-provider";
import { useEnvioFormulario } from "@/components/catalogo/use-envio-formulario";
import { obtenerPerfiles, crearPerfil, type MatrizPerfiles } from "@/lib/perfiles";
import { CeldaPermiso } from "./celda-permiso";
import { ColumnaPerfil } from "./columna-perfil";

// D5 del spec: mismo orden que ORDEN_GRUPOS en perfiles.repository.ts. Son
// valores de dato de `permiso.grupo`, no etiquetas de interfaz.
const ORDEN_GRUPOS = [
  "General",
  "Operacion Comercial",
  "Produccion/Almacen",
  "Informacion",
];

function TarjetaMensaje({ mensaje }: { mensaje: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Perfiles y Permisos</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-muted-foreground">{mensaje}</p>
      </CardContent>
    </Card>
  );
}

export function PantallaPerfiles() {
  const { puede, cargando } = useAuth();

  // D3 del spec: ni siquiera se intenta el GET sin el permiso -- se sabe de
  // antemano que la API responderia 403. Se espera a que la sesion termine de
  // cargar antes de decidir (si no, `puede()` devuelve false de entrada para
  // TODOS mientras `usuario` sigue en null, y un usuario con el permiso veria
  // el mensaje de "no tienes permiso" un instante antes de la matriz real).
  if (cargando) {
    return <TarjetaMensaje mensaje="Cargando…" />;
  }
  if (!puede("perfil.gestionar")) {
    return <TarjetaMensaje mensaje="No tienes permiso para ver esta sección." />;
  }
  return <Matriz />;
}

function Matriz() {
  const [datos, setDatos] = useState<MatrizPerfiles | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nombreNuevo, setNombreNuevo] = useState("");
  const {
    enviando: creando,
    error: errorAlta,
    enviar: enviarAlta,
  } = useEnvioFormulario("No se pudo crear el perfil.");

  // useCallback con deps vacias: setDatos/setError son estables (React lo
  // garantiza) y obtenerPerfiles() no depende de ningun prop/estado. Sin
  // esto, cada render crearia una `cargar` nueva y el useEffect de abajo
  // tendria que omitirla de sus deps o dispararse en cada render.
  const cargar = useCallback(() => {
    return obtenerPerfiles()
      .then((d) => {
        setDatos(d);
        setError(null);
      })
      .catch(() => setError("No se pudieron cargar los perfiles."));
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function altaPerfil() {
    const nombre = nombreNuevo.trim();
    if (!nombre) return;
    await enviarAlta(
      () => crearPerfil(nombre),
      () => {
        setNombreNuevo("");
        void cargar();
      },
    );
  }

  if (error) {
    return <TarjetaMensaje mensaje={error} />;
  }
  if (!datos) {
    return <TarjetaMensaje mensaje="Cargando…" />;
  }

  // Un permiso con un grupo fuera de ORDEN_GRUPOS debe seguir apareciendo en
  // la matriz aunque no tenga posicion fija: si se filtra, ese permiso nunca
  // se renderiza como fila y ningun administrador puede otorgarlo, sin que
  // nada avise del problema.
  const gruposConocidos = ORDEN_GRUPOS.filter((g) => datos.permisos.some((p) => p.grupo === g));
  const gruposDesconocidos = [...new Set(datos.permisos.map((p) => p.grupo))].filter(
    (g) => !ORDEN_GRUPOS.includes(g),
  );
  const grupos = [...gruposConocidos, ...gruposDesconocidos];
  const columnas = datos.perfiles.length + 2; // Permiso + N perfiles + alta

  return (
    <Card>
      <CardHeader>
        <CardTitle>Perfiles y Permisos</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th scope="col" className="py-2 font-medium">
                  Permiso
                </th>
                {datos.perfiles.map((perfil) => (
                  <th key={perfil.id} scope="col" className="py-2 font-medium">
                    <ColumnaPerfil perfil={perfil} alCambiar={() => void cargar()} />
                  </th>
                ))}
                <th scope="col" className="py-2 font-medium">
                  <input
                    aria-label="Nombre del nuevo perfil"
                    placeholder="Nuevo perfil…"
                    value={nombreNuevo}
                    disabled={creando}
                    onChange={(e) => setNombreNuevo(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void altaPerfil();
                    }}
                    className="w-32 rounded-md border px-2 py-1 text-sm font-normal"
                  />
                  {errorAlta && (
                    <p role="alert" className="text-xs font-normal text-destructive">
                      {errorAlta}
                    </p>
                  )}
                </th>
              </tr>
            </thead>
            <tbody>
              {grupos.map((grupo) => (
                <Fragment key={grupo}>
                  <tr className="border-b bg-muted/50">
                    <td colSpan={columnas} className="py-1 font-medium">
                      {grupo}
                    </td>
                  </tr>
                  {datos.permisos
                    .filter((p) => p.grupo === grupo)
                    .map((permiso) => (
                      <tr key={permiso.id} className="border-b last:border-0">
                        <th scope="row" className="py-2 text-left font-normal">
                          {permiso.descripcion ?? permiso.clave}
                        </th>
                        {datos.perfiles.map((perfil) => (
                          <td key={perfil.id} className="py-2">
                            <CeldaPermiso
                              perfilId={perfil.id}
                              permisoId={permiso.id}
                              habilitadoInicial={perfil.permisos.includes(permiso.clave)}
                              editable={!perfil.esMaestro}
                              etiqueta={`${permiso.descripcion ?? permiso.clave} · ${perfil.nombre}`}
                            />
                          </td>
                        ))}
                        <td />
                      </tr>
                    ))}
                </Fragment>
              ))}
              {datos.perfiles.length === 0 && (
                <tr>
                  <td colSpan={columnas} className="py-4 text-muted-foreground">
                    No hay perfiles.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
