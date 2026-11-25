"use client";

import { useRef, useState } from "react";
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
import { ErrorApi } from "@/lib/api";
import { esNotaSinSaldo } from "./registrar-pago";

const FALLO_SALDO = "No se pudo aplicar el saldo a favor.";

/**
 * §3.4, la lógica sin la pantalla: aplicar el saldo a favor del cliente a las
 * notas marcadas. No entra dinero: sin método ni cobrador. Por default, el menor
 * entre el saldo a favor y lo que deben las marcadas; nunca más que el saldo a
 * favor. Lo que exceda lo que deben lo rechaza el servidor (no se mueve saldo a
 * favor a saldo a favor). La usa *Procesos → Notas* (`RecuadroCobro`, "Usar
 * saldo a favor"); viene de la pantalla *Cobranza*, que se quitó en Procesos PR B.
 *
 * Quien la usa monta su componente con `key` de la selección y el saldo, para
 * que el monto propuesto se recalcule al cambiar cualquiera de los dos.
 */
export function useSaldoFavor({
  cliente,
  palomeadas,
  onAplicado,
  onDesactualizado,
}: {
  cliente: ClientePorCobrar;
  palomeadas: NotaPorCobrar[];
  onAplicado: (mensaje: string) => void;
  /** Recarga el cliente conservando este mensaje (el 409 "ya no tiene saldo"). */
  onDesactualizado: (mensaje: string) => void;
}) {
  const deben = palomeadas.reduce((t, n) => t + n.saldoCentavos, 0);
  const [montoTexto, setMontoTexto] = useState(() => textoMonto(Math.min(cliente.saldoFavorCentavos, deben)));
  const [vista, setVista] = useState<{ clave: string; plan: PlanDeCobro } | null>(null);
  const [previsualizando, setPrevisualizando] = useState(false);
  const [errorVista, setErrorVista] = useState<string | null>(null);
  const { enviando, error, enviar, limpiarError } = useEnvioFormulario(FALLO_SALDO);
  // La vista previa más reciente: una respuesta (o un error) de una petición anterior se ignora.
  const ultimaVista = useRef(0);

  const notaIds = palomeadas.map((n) => n.id);
  const monto = leerMontoCentavos(montoTexto);
  const clave = [palomeadas.map((n) => `${n.id}:${n.saldoCentavos}`).join(","), cliente.saldoFavorCentavos, monto].join("|");
  const plan = vista?.clave === clave ? vista.plan : null;

  function problema(): string | null {
    if (monto === null) return MENSAJE_MONTO;
    if (monto > cliente.saldoFavorCentavos)
      return `No puede ser mayor al saldo a favor (${formatearPesos(cliente.saldoFavorCentavos)}).`;
    return null;
  }

  async function revisar() {
    const motivo = problema();
    if (motivo !== null || monto === null) return;
    const mia = ++ultimaVista.current;
    setErrorVista(null);
    // Como antes del refactor: pedir la vista previa deja viejo el error de un grabado.
    limpiarError();
    setPrevisualizando(true);
    try {
      const nuevo = await vistaPreviaCobro({
        clienteId: cliente.id,
        notaIds,
        montoCentavos: monto,
        modo: "saldo_favor",
      });
      if (mia !== ultimaVista.current) return;
      setVista({ clave, plan: nuevo });
    } catch (err) {
      if (mia !== ultimaVista.current) return;
      setErrorVista(
        err instanceof ErrorApi ? (err.mensajeApi ?? FALLO_SALDO) : "No se pudo conectar con el servidor. Intenta de nuevo.",
      );
    } finally {
      if (mia === ultimaVista.current) setPrevisualizando(false);
    }
  }

  async function aplicar() {
    if (plan === null || monto === null) return;
    await enviar(
      async () => {
        try {
          const r = await aplicarSaldoFavor({ clienteId: cliente.id, notaIds, montoCentavos: monto });
          setVista(null);
          onAplicado(`Saldo a favor aplicado: ${formatearPesos(r.montoCentavos)} a ${r.cliente}`);
        } catch (err) {
          if (esNotaSinSaldo(err)) {
            setVista(null);
            onDesactualizado(err.mensajeApi ?? "Una nota ya no tiene saldo; vuelve a cargar.");
            return;
          }
          throw err;
        }
      },
      () => {},
    );
  }

  return {
    deben,
    montoTexto,
    setMontoTexto,
    clave,
    plan,
    problema,
    revisar,
    previsualizando,
    aplicar,
    enviando,
    error: error ?? errorVista,
  };
}
