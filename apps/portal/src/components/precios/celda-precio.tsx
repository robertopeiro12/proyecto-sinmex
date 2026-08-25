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

    await enviar(async () => {
      const actualizado = await actualizarPrecio({
        presentacionId,
        listaPrecioId,
        sucursalId,
        precio: numero,
      });
      alGuardar(actualizado.precio);
    }, () => {});
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
        disabled={enviando}
        value={valor}
        onChange={(e) => setValor(e.target.value)}
        onBlur={() => void guardar()}
        className="w-24 rounded-md border px-2 py-1 text-sm"
      />
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}
