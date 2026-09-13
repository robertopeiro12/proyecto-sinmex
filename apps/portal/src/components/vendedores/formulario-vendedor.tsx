"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
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
    <form
      onSubmit={alEnviar}
      className="mb-6 flex flex-col gap-4 rounded-md border p-4"
    >
      <h2 className="text-sm font-semibold">
        {esAlta ? "Nuevo vendedor" : `Editar ${vendedor.nombre}`}
      </h2>

      <div className="flex flex-wrap gap-4">
        <div className="flex flex-1 flex-col gap-1.5">
          <label htmlFor="nombre" className="text-sm font-medium">
            Nombre completo
          </label>
          <input
            id="nombre"
            required
            maxLength={120}
            disabled={enviando}
            placeholder="Nombre y apellido, para el folio"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            className="rounded-md border px-3 py-2 text-sm"
          />
        </div>

        {esAlta && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="login" className="text-sm font-medium">
              Login (app)
            </label>
            <input
              id="login"
              required
              maxLength={60}
              disabled={enviando}
              value={login}
              onChange={(e) => setLogin(e.target.value)}
              className="rounded-md border px-3 py-2 text-sm"
            />
          </div>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="contrasena" className="text-sm font-medium">
          {esAlta
            ? "Contraseña"
            : "Nueva contraseña (déjalo en blanco para no cambiarla)"}
        </label>
        <input
          id="contrasena"
          type="password"
          required={esAlta}
          maxLength={200}
          disabled={enviando}
          value={contrasena}
          onChange={(e) => setContrasena(e.target.value)}
          className="w-64 rounded-md border px-3 py-2 text-sm"
        />
      </div>

      {eligeSucursal && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="sucursal" className="text-sm font-medium">
            Sucursal
          </label>
          <select
            id="sucursal"
            required
            disabled={enviando}
            value={sucursalId}
            onChange={(e) => setSucursalId(e.target.value)}
            className="w-64 rounded-md border px-3 py-2 text-sm"
          >
            <option value="">Elige una sucursal…</option>
            {sucursales.map((s) => (
              <option key={s.id} value={s.id}>
                {s.codigo} · {s.nombre}
              </option>
            ))}
          </select>
        </div>
      )}

      {!esAlta && (
        <p className="text-xs text-muted-foreground">
          Sucursal: {vendedor.sucursalCodigo}. Segmento de folio:{" "}
          {vendedor.folioSegmento ?? "—"}. Ninguno de los dos se puede
          cambiar.
        </p>
      )}

      {!esAlta && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={activo}
            disabled={enviando}
            onChange={(e) => setActivo(e.target.checked)}
          />
          Activo
        </label>
      )}

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <Button type="submit" disabled={enviando}>
          {enviando ? "Guardando…" : "Guardar"}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={enviando}
          onClick={alCancelar}
        >
          Cancelar
        </Button>
      </div>
    </form>
  );
}
