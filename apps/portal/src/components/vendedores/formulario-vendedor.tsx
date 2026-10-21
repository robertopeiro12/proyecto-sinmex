"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Campo, Casilla, Entrada, Lista } from "@/components/ui/campo";
import { useAuth } from "@/components/auth/auth-provider";
import { useEnvioFormulario } from "@/components/catalogo/use-envio-formulario";
import { listarSucursales, type Sucursal } from "@/lib/sucursales";
import {
  crearVendedor,
  editarVendedor,
  type Vendedor,
} from "@/lib/vendedores";

interface Props {
  /** El vendedor a editar, o null para dar de alta uno nuevo. */
  vendedor: Vendedor | null;
  alGuardar: () => void;
  alCancelar: () => void;
}

export function FormularioVendedor({ vendedor, alGuardar, alCancelar }: Props) {
  const { usuario } = useAuth();
  const esAlta = vendedor === null;

  // Igual que FormularioVehiculo (T-11): la sucursal solo se elige en el
  // alta, y solo si quien la da es un usuario General. `vendedor` (D3) es
  // inmutable despues, asi que en edicion nunca se pinta el desplegable.
  const eligeSucursal = esAlta && usuario !== null && usuario.sucursal === null;

  const [nombre, setNombre] = useState(vendedor?.nombre ?? "");
  const [login, setLogin] = useState(vendedor?.login ?? "");
  const [contrasena, setContrasena] = useState("");
  const [activo, setActivo] = useState(vendedor?.activo ?? true);
  const [sucursalId, setSucursalId] = useState("");
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  const { enviando, error, enviar } = useEnvioFormulario(
    "No se pudo guardar el vendedor.",
  );

  useEffect(() => {
    if (!eligeSucursal) return;
    let vigente = true;

    void listarSucursales()
      .then((lista) => {
        if (vigente) setSucursales(lista.filter((s) => s.activa));
      })
      .catch(() => {});

    return () => {
      vigente = false;
    };
  }, [eligeSucursal]);

  async function alEnviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();

    await enviar(
      () =>
        vendedor
          ? editarVendedor(vendedor.id, {
              nombre,
              activo,
              // D2 del spec: vacio u omitido = "no cambiar". JSON.stringify
              // quita las claves en `undefined`, asi que el backend nunca la ve.
              contrasena: contrasena.trim() === "" ? undefined : contrasena,
            })
          : crearVendedor({
              nombre,
              login,
              contrasena,
              ...(eligeSucursal ? { sucursalId } : {}),
            }),
      alGuardar,
    );
  }

  return (
    <form onSubmit={alEnviar} className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-4">
        <Campo id="nombre" etiqueta="Nombre completo" className="flex-1">
          <Entrada
            id="nombre"
            required
            maxLength={120}
            disabled={enviando}
            placeholder="Nombre y apellido, para el folio"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
          />
        </Campo>

        {esAlta && (
          <Campo id="login" etiqueta="Login (app)">
            <Entrada
              id="login"
              required
              maxLength={60}
              disabled={enviando}
              value={login}
              onChange={(e) => setLogin(e.target.value)}
            />
          </Campo>
        )}
      </div>

      <Campo
        id="contrasena"
        etiqueta={
          esAlta
            ? "Contraseña"
            : "Nueva contraseña (déjalo en blanco para no cambiarla)"
        }
      >
        <Entrada
          id="contrasena"
          type="password"
          required={esAlta}
          maxLength={200}
          disabled={enviando}
          value={contrasena}
          onChange={(e) => setContrasena(e.target.value)}
          className="w-64"
        />
      </Campo>

      {eligeSucursal && (
        <Campo id="sucursal" etiqueta="Sucursal">
          <Lista
            id="sucursal"
            required
            disabled={enviando}
            value={sucursalId}
            onChange={(e) => setSucursalId(e.target.value)}
            className="w-64"
          >
            <option value="">Elige una sucursal…</option>
            {sucursales.map((s) => (
              <option key={s.id} value={s.id}>
                {s.codigo} · {s.nombre}
              </option>
            ))}
          </Lista>
        </Campo>
      )}

      {!esAlta && (
        <p className="text-xs text-muted-foreground">
          Sucursal: {vendedor.sucursalCodigo}. Segmento de folio:{" "}
          {vendedor.folioSegmento ?? "—"}. Ninguno de los dos se puede
          cambiar.
        </p>
      )}

      {!esAlta && (
        <Casilla
          etiqueta="Activo"
          checked={activo}
          disabled={enviando}
          onChange={(e) => setActivo(e.target.checked)}
        />
      )}

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" disabled={enviando} onClick={alCancelar}>
          Cancelar
        </Button>
        <Button type="submit" disabled={enviando}>
          {enviando ? "Guardando…" : "Guardar"}
        </Button>
      </div>
    </form>
  );
}
