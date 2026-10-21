"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Campo, Casilla, Entrada, Lista } from "@/components/ui/campo";
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
    <form onSubmit={alEnviar} className="flex flex-col gap-4">
      <Campo id="campo-egreso-nombre" etiqueta="Nombre del campo">
        <Entrada
          id="campo-egreso-nombre"
          required
          maxLength={80}
          disabled={enviando}
          placeholder="Gasolina, Hielo, Celular…"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
        />
      </Campo>

      <Campo id="campo-egreso-tipo" etiqueta="Tipo">
        <Lista
          id="campo-egreso-tipo"
          disabled={enviando}
          value={tipo}
          onChange={(e) => setTipo(e.target.value as TipoEgreso)}
          className="w-60"
        >
          {TIPOS_EGRESO.map((t) => (
            <option key={t} value={t}>
              {ETIQUETA_TIPO_EGRESO[t]}
            </option>
          ))}
        </Lista>
      </Campo>

      <div className="flex flex-col gap-1">
        <Casilla
          etiqueta="Se usa en la app"
          checked={seUsaEnApp}
          disabled={enviando}
          onChange={(e) => setSeUsaEnApp(e.target.checked)}
        />
        <p className="text-xs text-muted-foreground">
          El vendedor solo puede elegir en la tablet los campos con esta casilla. Si la cambias, los gastos ya capturados
          sin red suben igual. Cambiar el nombre o el tipo no toca los gastos ya registrados: guardan su copia.
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
        <Button type="submit" disabled={enviando}>
          {enviando ? "Guardando…" : "Guardar"}
        </Button>
      </div>
    </form>
  );
}
