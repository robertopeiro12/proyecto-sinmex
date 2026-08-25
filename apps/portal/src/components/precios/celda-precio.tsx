"use client";

import { useState } from "react";
import { useEnvioFormulario } from "@/components/catalogo/use-envio-formulario";
import { actualizarPrecio } from "@/lib/precios";

interface Props {
  presentacionId: string;
  listaPrecioId: string;
  sucursalId: string;
  /** null = todavia no tiene precio para esta combinacion (D6 del spec). */
  precioInicial: number | null;
  editable: boolean;
  alGuardar: (precio: number) => void;
}

const aTexto = (precio: number | null): string =>
  precio === null ? "" : precio.toString();

/**
 * Una celda de la matriz. El estado local arranca de `precioInicial` UNA sola
 * vez: `PantallaPrecios` remonta la matriz entera con `key={sucursalId}` al
 * cambiar de sucursal, asi que esta celda nunca necesita resincronizarse con
 * un prop que cambio por debajo -- evita el efecto que sincronizaria estado
 * con props, que perderia lo que el usuario esta tecleando si el padre
 * recargara por cualquier otro motivo.
 */
export function CeldaPrecio({
  presentacionId,
  listaPrecioId,
  sucursalId,
  precioInicial,
  editable,
  alGuardar,
}: Props) {
  const [valor, setValor] = useState(aTexto(precioInicial));
  const { enviando, error, enviar } = useEnvioFormulario(
    "No se pudo guardar el precio.",
  );

  async function guardar() {
    const texto = valor.trim();
    const numero = Number(texto);

    // Vacio, no numero, o sin cambio real: no hay nada que mandar. Restaura
    // el valor mostrado al ultimo precio conocido en vez de dejar la celda a
    // medio escribir.
    if (texto === "" || Number.isNaN(numero) || numero <= 0) {
      setValor(aTexto(precioInicial));
      return;
    }
    if (numero === precioInicial) {
      return;
    }

    // `accion` es SOLO la llamada a la API (mismo contrato que el resto de
    // los formularios que usan este hook -- ver formulario-vehiculo.tsx,
    // formulario-sucursal.tsx). `exito` se marca en `alTerminar`, que
    // `useEnvioFormulario` tambien corre dentro de su try/catch, asi que
    // sigue sin ser el lugar seguro para `alGuardar`: si `alGuardar`
    // (el `setPrecios` del padre) fallara, ese try/catch lo confundiria con
    // un fallo del PATCH. Por eso `alGuardar` se llama DESPUES de que
    // `enviar()` ya resolvio, fuera de cualquier try/catch de este hook.
    // `numero` (no `actualizado.precio`) es intencional: el backend
    // devuelve el mismo valor que mandamos, sin releerlo de la base (ver el
    // comentario de `upsert()` en precios.repository.ts), asi que no hace
    // falta esperar la respuesta para saber que precio quedo.
    let exito = false;
    await enviar(
      () =>
        actualizarPrecio({
          presentacionId,
          listaPrecioId,
          sucursalId,
          precio: numero,
        }),
      () => {
        exito = true;
      },
    );
    if (exito) alGuardar(numero);
  }

  if (!editable) {
    return (
      <span>{precioInicial === null ? "—" : precioInicial.toFixed(2)}</span>
    );
  }

  return (
    <div className="flex flex-col gap-0.5">
      <input
        type="number"
        min={0.01}
        step="0.01"
        placeholder="Sin precio"
        aria-label="Precio"
        disabled={enviando}
        value={valor}
        onChange={(e) => setValor(e.target.value)}
        onBlur={() => void guardar()}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        className="w-24 rounded-md border px-2 py-1 text-sm"
      />
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}
