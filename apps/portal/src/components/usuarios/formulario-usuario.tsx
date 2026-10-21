"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Campo, Entrada, Lista } from "@/components/ui/campo";
import { useAuth } from "@/components/auth/auth-provider";
import { useEnvioFormulario } from "@/components/catalogo/use-envio-formulario";
import { listarSucursales, type Sucursal } from "@/lib/sucursales";
import {
  crearUsuario,
  editarUsuario,
  obtenerCatalogoPerfiles,
  type CatalogoPerfiles,
  type UsuarioDetalle,
} from "@/lib/usuarios";
import { MatrizPermisosUsuario } from "./matriz-permisos-usuario";

interface Props {
  /** El usuario a editar, o null para dar de alta uno nuevo. */
  usuario: UsuarioDetalle | null;
  alGuardar: () => void;
  alCancelar: () => void;
}

export function FormularioUsuario({ usuario, alGuardar, alCancelar }: Props) {
  const { usuario: sesion } = useAuth();
  const esAlta = usuario === null;

  // D8 del spec: a diferencia de FormularioCliente (T-12, D6) y
  // FormularioVehiculo (T-11, D3), aqui el selector de sucursal aplica
  // TAMBIEN en edicion -- la sucursal de un Usuario no es inmutable.
  const eligeSucursal = sesion !== null && sesion.sucursal === null;

  const [login, setLogin] = useState(usuario?.login ?? "");
  const [nombre, setNombre] = useState(usuario?.nombre ?? "");
  const [contrasena, setContrasena] = useState("");
  const [perfilId, setPerfilId] = useState(usuario?.perfilId ?? "");
  const [sucursalId, setSucursalId] = useState(usuario?.sucursalId ?? "");
  const [marcados, setMarcados] = useState<Set<string>>(
    () => new Set(usuario?.permisosEfectivos ?? []),
  );

  const [catalogo, setCatalogo] = useState<CatalogoPerfiles | null>(null);
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  const { enviando, error, enviar } = useEnvioFormulario("No se pudo guardar el usuario.");

  useEffect(() => {
    let vigente = true;
    obtenerCatalogoPerfiles()
      .then((c) => {
        if (vigente) setCatalogo(c);
      })
      .catch(() => {});
    return () => {
      vigente = false;
    };
  }, []);

  useEffect(() => {
    if (!eligeSucursal) return;
    let vigente = true;
    listarSucursales()
      .then((lista) => {
        if (!vigente) return;
        // La sucursal ACTUAL del usuario que se edita se incluye aunque ya
        // este desactivada -- si no, el <select> controlado no encuentra
        // su value entre las opciones y aparenta "General" sin serlo (el
        // dato real no se pierde, solo deja de verse). No aplica en el
        // alta: ahi sucursalId todavia no tiene valor.
        const activas = lista.filter((s) => s.activa);
        const actual = usuario
          ? lista.find((s) => s.id === usuario.sucursalId)
          : undefined;
        setSucursales(
          actual && !activas.some((s) => s.id === actual.id)
            ? [...activas, actual]
            : activas,
        );
      })
      .catch(() => {});
    return () => {
      vigente = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- usuario.sucursalId no cambia tras el montaje (PantallaUsuarios remonta con `key` en cada edicion, ver Task 10/11).
  }, [eligeSucursal]);

  const perfilElegido = catalogo?.perfiles.find((p) => p.id === perfilId) ?? null;

  /**
   * D3 del spec: cambiar de perfil reinicia la matriz a lo que ESE perfil
   * da por default -- pisa `marcados` solo cuando el administrador de
   * verdad elige un perfil distinto (no en cada render: `marcados` nace ya
   * inicializado desde `usuario.permisosEfectivos` en edicion).
   */
  function alElegirPerfil(nuevoId: string) {
    setPerfilId(nuevoId);
    const nuevo = catalogo?.perfiles.find((p) => p.id === nuevoId);
    if (nuevo) {
      setMarcados(new Set(nuevo.permisos));
    }
  }

  function alCambiarPermiso(clave: string, marcado: boolean) {
    setMarcados((previos) => {
      const copia = new Set(previos);
      if (marcado) {
        copia.add(clave);
      } else {
        copia.delete(clave);
      }
      return copia;
    });
  }

  async function alEnviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();

    const datos = {
      login,
      nombre,
      perfilId,
      permisosMarcados: Array.from(marcados),
      ...(eligeSucursal ? { sucursalId: sucursalId === "" ? undefined : sucursalId } : {}),
    };

    await enviar(
      () =>
        usuario
          ? editarUsuario(usuario.id, {
              ...datos,
              // D2: vacio u omitido = "no cambiar" -- JSON.stringify quita
              // las claves en `undefined`, asi que el backend nunca la ve.
              contrasena: contrasena.trim() === "" ? undefined : contrasena,
            })
          : crearUsuario({ ...datos, contrasena }),
      alGuardar,
    );
  }

  if (!catalogo) {
    return <p className="text-muted-foreground">Cargando…</p>;
  }

  return (
    <form onSubmit={alEnviar} className="flex flex-col gap-6">
      <fieldset className="flex flex-col gap-4">
        <legend className="mb-1 text-sm font-semibold text-muted-foreground">
          Datos básicos
        </legend>
        <div className="flex flex-wrap gap-4">
          <Campo id="login" etiqueta="Login">
            <Entrada
              id="login"
              required
              maxLength={60}
              disabled={enviando}
              value={login}
              onChange={(e) => setLogin(e.target.value)}
            />
          </Campo>
          <Campo id="nombre" etiqueta="Nombre" className="flex-1">
            <Entrada
              id="nombre"
              required
              maxLength={120}
              disabled={enviando}
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
            />
          </Campo>
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-1 text-sm font-semibold text-muted-foreground">
          Contraseña
        </legend>
        <Campo
          id="contrasena"
          etiqueta={esAlta ? "Contraseña" : "Nueva contraseña (déjalo en blanco para no cambiarla)"}
        >
          <Entrada
            id="contrasena"
            type="password"
            required={esAlta}
            minLength={8}
            maxLength={200}
            disabled={enviando}
            value={contrasena}
            onChange={(e) => setContrasena(e.target.value)}
            className="w-64"
          />
        </Campo>
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-1 text-sm font-semibold text-muted-foreground">
          Perfil y sucursal
        </legend>
        <div className="flex flex-wrap gap-4">
          <Campo id="perfil" etiqueta="Perfil">
            <Lista
              id="perfil"
              required
              disabled={enviando}
              value={perfilId}
              onChange={(e) => alElegirPerfil(e.target.value)}
              className="w-56"
            >
              <option value="">Elige un perfil…</option>
              {catalogo.perfiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                </option>
              ))}
            </Lista>
          </Campo>
          {eligeSucursal ? (
            <Campo id="sucursal" etiqueta="Sucursal">
              <Lista
                id="sucursal"
                disabled={enviando}
                value={sucursalId}
                onChange={(e) => setSucursalId(e.target.value)}
                className="w-48"
              >
                <option value="">General (todas)</option>
                {sucursales.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.codigo} — {s.nombre}
                    {!s.activa ? " (inactiva)" : ""}
                  </option>
                ))}
              </Lista>
            </Campo>
          ) : (
            <p className="self-end text-sm text-muted-foreground">
              Sucursal: {sesion?.sucursal?.codigo ?? "General"}
            </p>
          )}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-1 text-sm font-semibold text-muted-foreground">
          Permisos
        </legend>
        {perfilElegido ? (
          <MatrizPermisosUsuario
            catalogo={catalogo.permisos}
            marcados={marcados}
            onCambiar={alCambiarPermiso}
            disabled={perfilElegido.esMaestro}
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            Elige un perfil para configurar sus permisos.
          </p>
        )}
      </fieldset>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <Button type="submit" disabled={enviando}>
          {enviando ? "Guardando…" : "Guardar"}
        </Button>
        <Button type="button" variant="outline" disabled={enviando} onClick={alCancelar}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
