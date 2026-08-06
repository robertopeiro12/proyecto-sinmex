"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { ErrorApi } from "@/lib/api";
import { crearSucursal, editarSucursal, type Sucursal } from "@/lib/sucursales";

interface Props {
  /** La sucursal a editar, o null para dar de alta una nueva. */
  sucursal: Sucursal | null;
  alGuardar: () => void;
  alCancelar: () => void;
}

export function FormularioSucursal({ sucursal, alGuardar, alCancelar }: Props) {
  const [codigo, setCodigo] = useState(sucursal?.codigo ?? "");
  const [nombre, setNombre] = useState(sucursal?.nombre ?? "");
  const [activa, setActiva] = useState(sucursal?.activa ?? true);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const esAlta = sucursal === null;

  async function alEnviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setError(null);
    setEnviando(true);

    try {
      if (sucursal) {
        await editarSucursal(sucursal.id, { nombre, activa });
      } else {
        await crearSucursal({ codigo, nombre });
      }
      alGuardar();
    } catch (err) {
      // El mensaje del servidor se muestra tal cual cuando existe: el 409 dice
      // exactamente que codigo esta repetido y el 400 dice que campo fallo.
      setError(
        err instanceof ErrorApi
          ? (err.mensajeApi ?? "No se pudo guardar la sucursal.")
          : "No se pudo conectar con el servidor. Intenta de nuevo.",
      );
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form
      onSubmit={alEnviar}
      className="mb-6 flex flex-col gap-4 rounded-md border p-4"
    >
      <h2 className="text-sm font-semibold">
        {esAlta ? "Nueva sucursal" : `Editar ${sucursal.codigo}`}
      </h2>

      <div className="flex flex-wrap gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="codigo" className="text-sm font-medium">
            Código
          </label>
          <input
            id="codigo"
            name="codigo"
            required
            maxLength={2}
            // Solo lectura al editar: el codigo abre los folios historicos y
            // cambiarlo los dejaria apuntando a algo que ya no existe.
            readOnly={!esAlta}
            disabled={enviando}
            value={codigo}
            onChange={(e) => setCodigo(e.target.value.toUpperCase())}
            className="w-24 rounded-md border px-3 py-2 text-sm uppercase read-only:bg-muted read-only:text-muted-foreground"
          />
          {!esAlta && (
            <span className="text-xs text-muted-foreground">
              El código no se puede cambiar.
            </span>
          )}
        </div>

        <div className="flex flex-1 flex-col gap-1.5">
          <label htmlFor="nombre" className="text-sm font-medium">
            Nombre
          </label>
          <input
            id="nombre"
            name="nombre"
            required
            maxLength={80}
            disabled={enviando}
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            className="rounded-md border px-3 py-2 text-sm"
          />
        </div>
      </div>

      {!esAlta && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={activa}
            disabled={enviando}
            onChange={(e) => setActiva(e.target.checked)}
          />
          Activa
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
