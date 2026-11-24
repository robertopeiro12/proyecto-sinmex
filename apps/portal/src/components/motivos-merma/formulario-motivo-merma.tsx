"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Campo, Casilla, Entrada } from "@/components/ui/campo";
import { useEnvioFormulario } from "@/components/catalogo/use-envio-formulario";
import { crearMotivoMerma, editarMotivoMerma, type MotivoMerma } from "@/lib/motivos-merma";

interface Props {
  motivo: MotivoMerma | null;
  alGuardar: () => void;
  alCancelar: () => void;
}

/** Alta y edición de un motivo de merma: el nombre y dónde aplica (al menos un lugar). */
export function FormularioMotivoMerma({ motivo, alGuardar, alCancelar }: Props) {
  const [nombre, setNombre] = useState(motivo?.nombre ?? "");
  const [aplicaAlmacen, setAplicaAlmacen] = useState(motivo?.aplicaAlmacen ?? true);
  const [aplicaCliente, setAplicaCliente] = useState(motivo?.aplicaCliente ?? true);
  const [aplicaVehiculo, setAplicaVehiculo] = useState(motivo?.aplicaVehiculo ?? true);
  const { enviando, error, enviar } = useEnvioFormulario("No se pudo guardar el motivo.");
  const sinLugar = !aplicaAlmacen && !aplicaCliente && !aplicaVehiculo;

  async function alEnviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const datos = { nombre, aplicaAlmacen, aplicaCliente, aplicaVehiculo };
    await enviar(() => (motivo ? editarMotivoMerma(motivo.id, datos) : crearMotivoMerma(datos)), alGuardar);
  }

  return (
    <form onSubmit={alEnviar} className="flex flex-col gap-4">
      <Campo id="motivo-nombre" etiqueta="Nombre del motivo">
        <Entrada
          id="motivo-nombre"
          required
          maxLength={80}
          disabled={enviando}
          placeholder="Producto dañado, Caducado…"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
        />
      </Campo>

      <div className="flex flex-col gap-2">
        <Casilla etiqueta="Almacén" checked={aplicaAlmacen} disabled={enviando} onChange={(e) => setAplicaAlmacen(e.target.checked)} />
        <Casilla etiqueta="Cliente" checked={aplicaCliente} disabled={enviando} onChange={(e) => setAplicaCliente(e.target.checked)} />
        <Casilla etiqueta="Vehículo" checked={aplicaVehiculo} disabled={enviando} onChange={(e) => setAplicaVehiculo(e.target.checked)} />
        <p className="text-xs text-muted-foreground">
          Dónde se puede elegir este motivo. Tiene que aplicar al menos a un lugar.
        </p>
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" disabled={enviando} onClick={alCancelar}>
          Cancelar
        </Button>
        <Button type="submit" disabled={enviando || sinLugar}>
          {enviando ? "Guardando…" : "Guardar"}
        </Button>
      </div>
    </form>
  );
}
