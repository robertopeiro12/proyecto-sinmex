"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useEnvioFormulario } from "@/components/catalogo/use-envio-formulario";
import {
  MENSAJE_MONTO,
  aplicarSaldoFavor,
  leerMontoCentavos,
  textoMonto,
  vistaPreviaCobro,
  type ClientePorCobrar,
  type NotaPorCobrar,
  type PlanDeCobro,
} from "@/lib/cobranzas";
import { formatearPesos } from "@/lib/ventas";
import { VistaPreviaCobro } from "./vista-previa-cobro";

/**
 * §3.4: aplicar el saldo a favor del cliente a las notas marcadas. No entra
 * dinero: sin método ni cobrador. Por default, el menor entre el saldo a favor
 * y lo que deben las marcadas; nunca más que el saldo a favor. Lo que exceda lo
 * que deben lo rechaza el servidor (no se mueve saldo a favor a saldo a favor).
 *
 * El padre lo monta con `key` de la selección y el saldo, para que el monto
 * propuesto se recalcule al cambiar cualquiera de los dos.
 */
export function AplicarSaldoFavor({
  cliente,
  palomeadas,
  onAplicado,
}: {
  cliente: ClientePorCobrar;
  palomeadas: NotaPorCobrar[];
  onAplicado: (mensaje: string) => void;
}) {
  const deben = palomeadas.reduce((t, n) => t + n.saldoCentavos, 0);
  const [montoTexto, setMontoTexto] = useState(() => textoMonto(Math.min(cliente.saldoFavorCentavos, deben)));
  const [vista, setVista] = useState<{ clave: string; plan: PlanDeCobro } | null>(null);
  const [avisoLocal, setAvisoLocal] = useState<string | null>(null);
  const { enviando, error, enviar } = useEnvioFormulario("No se pudo aplicar el saldo a favor.");

  const notaIds = palomeadas.map((n) => n.id);
  const monto = leerMontoCentavos(montoTexto);
  const clave = [palomeadas.map((n) => `${n.id}:${n.saldoCentavos}`).join(","), cliente.saldoFavorCentavos, monto].join("|");
  const plan = vista?.clave === clave ? vista.plan : null;

  async function revisar() {
    const motivo =
      monto === null
        ? MENSAJE_MONTO
        : monto > cliente.saldoFavorCentavos
          ? `No puede ser mayor al saldo a favor (${formatearPesos(cliente.saldoFavorCentavos)}).`
          : null;
    setAvisoLocal(motivo);
    if (motivo !== null || monto === null) return;
    await enviar(
      async () => {
        const nuevo = await vistaPreviaCobro({
          clienteId: cliente.id,
          notaIds,
          montoCentavos: monto,
          modo: "saldo_favor",
        });
        setVista({ clave, plan: nuevo });
      },
      () => {},
    );
  }

  async function aplicar() {
    if (plan === null || monto === null) return;
    await enviar(
      async () => {
        const r = await aplicarSaldoFavor({ clienteId: cliente.id, notaIds, montoCentavos: monto });
        setVista(null);
        onAplicado(`Saldo a favor aplicado: ${formatearPesos(r.montoCentavos)} a ${r.cliente}`);
      },
      () => {},
    );
  }

  return (
    <section aria-label="Aplicar saldo a favor" className="flex flex-col gap-3 rounded-md border p-4">
      <h3 className="font-semibold">Aplicar saldo a favor</h3>
      <p className="text-sm text-muted-foreground">
        Tiene {formatearPesos(cliente.saldoFavorCentavos)} a favor; las notas marcadas deben {formatearPesos(deben)}.
        No entra dinero: no lleva método ni cobrador.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="saldo-monto" className="text-sm font-medium">
            Monto a aplicar
          </label>
          <input
            id="saldo-monto"
            inputMode="decimal"
            value={montoTexto}
            onChange={(e) => setMontoTexto(e.target.value)}
            disabled={enviando}
            className="w-36 rounded-md border px-3 py-2 text-sm"
          />
        </div>
        <Button type="button" variant="outline" onClick={() => void revisar()} disabled={enviando}>
          Vista previa
        </Button>
      </div>

      {avisoLocal && (
        <p role="alert" className="text-sm text-destructive">
          {avisoLocal}
        </p>
      )}

      {plan && (
        <>
          <VistaPreviaCobro plan={plan} palomeadas={palomeadas} />
          <div>
            <Button type="button" onClick={() => void aplicar()} disabled={enviando}>
              {enviando ? "Aplicando…" : "Aplicar saldo a favor"}
            </Button>
          </div>
        </>
      )}

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
