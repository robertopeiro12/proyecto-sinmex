"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useEnvioFormulario } from "@/components/catalogo/use-envio-formulario";
import {
  MENSAJE_MONTO,
  METODOS_PAGO_COBRO,
  leerMontoCentavos,
  registrarCobro,
  vistaPreviaCobro,
  type ClientePorCobrar,
  type MetodoPagoCobro,
  type NotaPorCobrar,
  type PlanDeCobro,
} from "@/lib/cobranzas";
import { REPARTIDOR_OFICINA, formatearPesos, hoyEnTijuana, listarRepartidores, type Repartidor } from "@/lib/ventas";
import { VistaPreviaCobro } from "./vista-previa-cobro";

/**
 * §3.3: monto, fecha, método y cobrador → vista previa calculada en el servidor
 * → grabar. Cualquier cambio deja vieja la vista previa (y desaparece "Grabar
 * cobro"): lo que se graba es lo que se vio. Al grabar, el servidor vuelve a
 * decidir con las notas bloqueadas; si algo cambió, lo dice con un 409.
 */
export function RegistrarPago({
  cliente,
  palomeadas,
  onRegistrado,
}: {
  cliente: ClientePorCobrar;
  palomeadas: NotaPorCobrar[];
  onRegistrado: (mensaje: string) => void;
}) {
  const hoy = hoyEnTijuana();
  const masVieja = palomeadas.map((n) => n.fecha).sort()[0] ?? hoy;
  const deben = palomeadas.reduce((t, n) => t + n.saldoCentavos, 0);

  const [montoTexto, setMontoTexto] = useState("");
  const [fechaPago, setFechaPago] = useState(hoy);
  const [metodo, setMetodo] = useState<MetodoPagoCobro>("transferencia");
  const [cobrador, setCobrador] = useState(REPARTIDOR_OFICINA);
  const [repartidores, setRepartidores] = useState<Repartidor[]>([]);
  const [vista, setVista] = useState<{ clave: string; plan: PlanDeCobro } | null>(null);
  const [avisoLocal, setAvisoLocal] = useState<string | null>(null);
  const { enviando, error, enviar } = useEnvioFormulario("No se pudo registrar el cobro.");

  useEffect(() => {
    let vigente = true;
    listarRepartidores(cliente.sucursalId)
      .then((lista) => {
        if (vigente) setRepartidores(lista);
      })
      .catch(() => {});
    return () => {
      vigente = false;
    };
  }, [cliente.sucursalId]);

  const notaIds = palomeadas.map((n) => n.id);
  const monto = leerMontoCentavos(montoTexto);
  const clave = [notaIds.join(","), monto, fechaPago, metodo, cobrador].join("|");
  const plan = vista?.clave === clave ? vista.plan : null;

  /** Lo mismo que rechazaría el servidor, dicho antes de pedir nada. */
  function problema(): string | null {
    if (monto === null) return MENSAJE_MONTO;
    if (fechaPago > hoy) return "La fecha del pago no puede ser futura.";
    if (fechaPago < masVieja)
      return `La fecha del pago no puede ser anterior a la nota más vieja que marcaste (${masVieja}).`;
    return null;
  }

  async function revisar() {
    const motivo = problema();
    setAvisoLocal(motivo);
    if (motivo !== null || monto === null) return;
    await enviar(
      async () => {
        const nuevo = await vistaPreviaCobro({ clienteId: cliente.id, notaIds, montoCentavos: monto, modo: "pago" });
        setVista({ clave, plan: nuevo });
      },
      () => {},
    );
  }

  async function grabar() {
    if (plan === null || monto === null) return;
    await enviar(
      async () => {
        const cobro = await registrarCobro({
          clienteId: cliente.id,
          notaIds,
          montoCentavos: monto,
          fechaPago,
          metodoPago: metodo,
          vendedorId: cobrador === REPARTIDOR_OFICINA ? null : cobrador,
        });
        setVista(null);
        setMontoTexto("");
        onRegistrado(`Cobro registrado: ${formatearPesos(cobro.montoCentavos)} a ${cobro.cliente}`);
      },
      () => {},
    );
  }

  return (
    <section aria-label="Registrar pago" className="flex flex-col gap-3 rounded-md border p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-semibold">Registrar pago</h3>
        <p className="text-sm text-muted-foreground">
          {palomeadas.length} {palomeadas.length === 1 ? "nota marcada" : "notas marcadas"} · deben{" "}
          {formatearPesos(deben)}
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="pago-monto" className="text-sm font-medium">
            Monto
          </label>
          <input
            id="pago-monto"
            inputMode="decimal"
            placeholder="0.00"
            value={montoTexto}
            onChange={(e) => setMontoTexto(e.target.value)}
            disabled={enviando}
            className="w-36 rounded-md border px-3 py-2 text-sm"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="pago-fecha" className="text-sm font-medium">
            Fecha del pago
          </label>
          <input
            id="pago-fecha"
            type="date"
            min={masVieja}
            max={hoy}
            value={fechaPago}
            onChange={(e) => setFechaPago(e.target.value)}
            disabled={enviando}
            className="rounded-md border px-3 py-2 text-sm"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="pago-metodo" className="text-sm font-medium">
            Método
          </label>
          <select
            id="pago-metodo"
            value={metodo}
            onChange={(e) => setMetodo(e.target.value as MetodoPagoCobro)}
            disabled={enviando}
            className="rounded-md border px-3 py-2 text-sm"
          >
            {METODOS_PAGO_COBRO.map((m) => (
              <option key={m.valor} value={m.valor}>
                {m.texto}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="pago-cobrador" className="text-sm font-medium">
            Cobró
          </label>
          <select
            id="pago-cobrador"
            value={cobrador}
            onChange={(e) => setCobrador(e.target.value)}
            disabled={enviando}
            className="w-56 rounded-md border px-3 py-2 text-sm"
          >
            <option value={REPARTIDOR_OFICINA}>Oficina</option>
            {repartidores.map((r) => (
              <option key={r.id} value={r.id}>
                {r.nombre}
              </option>
            ))}
          </select>
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
            <Button type="button" onClick={() => void grabar()} disabled={enviando}>
              {enviando ? "Grabando…" : "Grabar cobro"}
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
