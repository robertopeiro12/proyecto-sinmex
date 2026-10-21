"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Campo, Casilla, Entrada } from "@/components/ui/campo";
import { useEnvioFormulario } from "@/components/catalogo/use-envio-formulario";
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
  const [controlInventario, setControlInventario] = useState(sucursal?.controlInventario ?? false);
  const { enviando, error, enviar } = useEnvioFormulario(
    "No se pudo guardar la sucursal.",
  );

  const esAlta = sucursal === null;

  async function alEnviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    await enviar(
      () =>
        sucursal
          ? editarSucursal(sucursal.id, { nombre, activa, controlInventario })
          : crearSucursal({ codigo, nombre }),
      alGuardar,
    );
  }

  return (
    <form onSubmit={alEnviar} className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-4">
        <Campo
          id="codigo"
          etiqueta="Código"
          ayuda={!esAlta ? "El código no se puede cambiar." : undefined}
        >
          <Entrada
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
            className="w-24 uppercase read-only:bg-muted read-only:text-muted-foreground"
          />
        </Campo>

        <Campo id="nombre" etiqueta="Nombre" className="flex-1">
          <Entrada
            id="nombre"
            name="nombre"
            required
            maxLength={80}
            disabled={enviando}
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
          />
        </Campo>
      </div>

      {!esAlta && (
        <Casilla
          etiqueta="Activa"
          checked={activa}
          disabled={enviando}
          onChange={(e) => setActiva(e.target.checked)}
        />
      )}

      {!esAlta && (
        <div className="flex flex-col gap-1">
          <Casilla
            etiqueta="Control de inventario en la app"
            checked={controlInventario}
            disabled={enviando}
            onChange={(e) => setControlInventario(e.target.checked)}
          />
          <span className="text-xs text-muted-foreground">
            Al prenderla, los vendedores de esta sucursal necesitan aceptar su carga para vender y no pueden vender
            más de lo que traen.
          </span>
        </div>
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
