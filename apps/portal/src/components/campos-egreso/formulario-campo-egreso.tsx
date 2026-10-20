"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { useEnvioFormulario } from "@/components/catalogo/use-envio-formulario";
import {
  crearCampoEgreso,
  editarCampoEgreso,
  ETIQUETA_TIPO_EGRESO,
  TIPOS_EGRESO,
  type CampoEgreso,
  type TipoEgreso,
} from "@/lib/campos-egreso";

interface Props {
  campo: CampoEgreso | null;
  alGuardar: () => void;
  alCancelar: () => void;
}

/** Alta y edición de un campo de egreso: nombre, tipo (de los tres fijos) y "Se usa en la app" (T-30, D3). */
export function FormularioCampoEgreso({ campo, alGuardar, alCancelar }: Props) {
  const [nombre, setNombre] = useState(campo?.nombre ?? "");
  // Siete de los ocho campos de la semilla son de Operación: es el valor más probable.
  const [tipo, setTipo] = useState<TipoEgreso>(campo?.tipo ?? "operacion");
  const [seUsaEnApp, setSeUsaEnApp] = useState(campo?.seUsaEnApp ?? false);
  const { enviando, error, enviar } = useEnvioFormulario("No se pudo guardar el campo.");

  async function alEnviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const datos = { nombre, tipo, seUsaEnApp };
    await enviar(() => (campo ? editarCampoEgreso(campo.id, datos) : crearCampoEgreso(datos)), alGuardar);
  }

  return (
    <form onSubmit={alEnviar} className="mb-6 flex flex-col gap-4 rounded-md border p-4">
      <h2 className="text-sm font-semibold">{campo ? `Editar ${campo.nombre}` : "Nuevo campo"}</h2>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="campo-egreso-nombre" className="text-sm font-medium">
          Nombre del campo
        </label>
        <input
          id="campo-egreso-nombre"
          required
          maxLength={80}
          disabled={enviando}
          placeholder="Gasolina, Hielo, Celular…"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          className="w-96 max-w-full rounded-md border px-3 py-2 text-sm"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="campo-egreso-tipo" className="text-sm font-medium">
          Tipo
        </label>
        <select
          id="campo-egreso-tipo"
          disabled={enviando}
          value={tipo}
          onChange={(e) => setTipo(e.target.value as TipoEgreso)}
          className="w-60 rounded-md border px-3 py-2 text-sm"
        >
          {TIPOS_EGRESO.map((t) => (
            <option key={t} value={t}>
              {ETIQUETA_TIPO_EGRESO[t]}
            </option>
          ))}
        </select>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={seUsaEnApp}
          disabled={enviando}
          onChange={(e) => setSeUsaEnApp(e.target.checked)}
        />
        Se usa en la app
      </label>
      <p className="text-xs text-muted-foreground">
        El vendedor solo puede elegir en la tablet los campos con esta casilla. Si la cambias, los gastos ya capturados
        sin red suben igual. Cambiar el nombre o el tipo no toca los gastos ya registrados: guardan su copia.
      </p>

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
