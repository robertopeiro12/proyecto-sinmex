"use client";

import { useState, type FormEvent } from "react";
import { useEnvioFormulario } from "@/components/catalogo/use-envio-formulario";
import { Aviso } from "@/components/ui/aviso";
import { Button } from "@/components/ui/button";
import { Campo, Entrada } from "@/components/ui/campo";
import { LARGO_MAX_NUMERO_FACTURA, asignarFactura } from "@/lib/facturas";
import { formatearPesos, plural } from "@/lib/formato";

/**
 * *Procesos → Notas* (spec D2): anotar el número de factura en las ventas ya
 * marcadas en la lista (N/A o pendiente; una ya facturada no). Va dentro de una
 * `Ventana`; el backend (`POST /facturas/asignar`, T-19) decide si se puede.
 */
export function AnotarFactura({
  clienteId,
  ventas,
  onAnotada,
  onCancelar,
}: {
  clienteId: string;
  ventas: { id: string; montoCentavos: number }[];
  onAnotada: (mensaje: string) => void;
  onCancelar: () => void;
}) {
  const [numero, setNumero] = useState("");
  const { enviando, error, enviar } = useEnvioFormulario("No se pudo anotar la factura.");
  const total = ventas.reduce((t, v) => t + v.montoCentavos, 0);

  async function alEnviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    let mensaje = "";
    await enviar(
      async () => {
        const factura = await asignarFactura(
          clienteId,
          numero.trim(),
          ventas.map((v) => v.id),
        );
        mensaje = `Factura ${factura.numero} anotada en ${plural(ventas.length, "venta", "ventas")} (${formatearPesos(total)}).`;
      },
      () => onAnotada(mensaje),
    );
  }

  return (
    <form onSubmit={alEnviar} className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        {`${plural(ventas.length, "venta marcada", "ventas marcadas")} · ${formatearPesos(total)}. El número es el de la factura del SAT.`}
      </p>
      <Campo id="anotar-numero-factura" etiqueta="Número de factura">
        <Entrada
          maxLength={LARGO_MAX_NUMERO_FACTURA}
          value={numero}
          onChange={(e) => setNumero(e.target.value)}
          disabled={enviando}
          className="w-48"
        />
      </Campo>
      {error && <Aviso tono="error">{error}</Aviso>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancelar} disabled={enviando}>
          Cancelar
        </Button>
        <Button type="submit" disabled={enviando || numero.trim() === ""}>
          {enviando ? "Anotando…" : "Anotar factura"}
        </Button>
      </div>
    </form>
  );
}
