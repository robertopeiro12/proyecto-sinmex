"use client";

import { useEffect, useRef, useState } from "react";
import { formatearFecha } from "@/lib/formato";
import { useEnvioFormulario } from "@/components/catalogo/use-envio-formulario";
import {
  MENSAJE_MONTO,
  leerMontoCentavos,
  registrarCobro,
  vistaPreviaCobro,
  type ClientePorCobrar,
  type MetodoPagoCobro,
  type NotaPorCobrar,
  type PlanDeCobro,
} from "@/lib/cobranzas";
import { REPARTIDOR_OFICINA, formatearPesos, hoyEnTijuana, listarRepartidores, type Repartidor } from "@/lib/ventas";
import { ErrorApi } from "@/lib/api";

/** El 409 de "la nota ya no tiene saldo": lo que se ve en pantalla quedó viejo. */
export function esNotaSinSaldo(err: unknown): err is ErrorApi {
  return err instanceof ErrorApi && err.status === 409 && (err.mensajeApi ?? "").includes("ya no tiene saldo");
}

/** El mensaje de un fallo, igual que `useEnvioFormulario`. */
function mensajeDeFallo(err: unknown, porDefecto: string): string {
  return err instanceof ErrorApi
    ? (err.mensajeApi ?? porDefecto)
    : "No se pudo conectar con el servidor. Intenta de nuevo.";
}

const FALLO_COBRO = "No se pudo registrar el cobro.";

/**
 * §3.3, la lógica del pago sin la pantalla: monto, fecha, método y cobrador →
 * vista previa calculada en el servidor → grabar. La usa *Procesos → Notas*
 * (`RecuadroCobro`, que pide la vista previa sola); viene de la pantalla
 * *Cobranza*, que se quitó en Procesos PR B. Cualquier cambio deja vieja
 * la vista previa (`plan` vuelve a `null`), y toda recarga del cliente la
 * invalida. Al grabar, el servidor vuelve a repartir con los saldos del momento y
 * las notas bloqueadas: si un cobro de la tablet entró entre la vista previa y
 * el grabado, el excedente puede ir a otro lado que el que se vio. Si una nota ya
 * no tiene saldo (409), se avisa con `onDesactualizado` para recargar.
 *
 * La vista previa no usa `enviando`: pedirla mientras se escribe no debe
 * deshabilitar (y desenfocar) los campos.
 */
export function usePago({
  cliente,
  palomeadas,
  onRegistrado,
  onDesactualizado,
}: {
  cliente: ClientePorCobrar;
  palomeadas: NotaPorCobrar[];
  onRegistrado: (mensaje: string) => void;
  /** Recarga el cliente conservando este mensaje (el 409 "ya no tiene saldo"). */
  onDesactualizado: (mensaje: string) => void;
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
  const [previsualizando, setPrevisualizando] = useState(false);
  const [errorVista, setErrorVista] = useState<string | null>(null);
  const { enviando, error, enviar, limpiarError } = useEnvioFormulario(FALLO_COBRO);
  // La vista previa más reciente: una respuesta (o un error) de una petición anterior se ignora.
  const ultimaVista = useRef(0);

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
  const clave = [palomeadas.map((n) => `${n.id}:${n.saldoCentavos}`).join(","), cliente.saldoFavorCentavos, monto, fechaPago, metodo, cobrador].join("|");
  const plan = vista?.clave === clave ? vista.plan : null;

  /** Lo mismo que rechazaría el servidor, dicho antes de pedir nada. */
  function problema(): string | null {
    if (monto === null) return MENSAJE_MONTO;
    if (fechaPago === "") return "Elige la fecha del pago.";
    if (fechaPago > hoy) return "La fecha del pago no puede ser futura.";
    if (fechaPago < masVieja)
      return `La fecha del pago no puede ser anterior a la nota más vieja que marcaste (${formatearFecha(masVieja)}).`;
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
      const nuevo = await vistaPreviaCobro({ clienteId: cliente.id, notaIds, montoCentavos: monto, modo: "pago" });
      if (mia !== ultimaVista.current) return;
      // Con la clave de cuando se pidió: una respuesta que llega tarde no vale para lo que hay ahora.
      setVista({ clave, plan: nuevo });
    } catch (err) {
      if (mia !== ultimaVista.current) return;
      setErrorVista(mensajeDeFallo(err, FALLO_COBRO));
    } finally {
      if (mia === ultimaVista.current) setPrevisualizando(false);
    }
  }

  async function grabar() {
    if (plan === null || monto === null) return;
    await enviar(
      async () => {
        try {
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
    hoy,
    masVieja,
    deben,
    montoTexto,
    setMontoTexto,
    fechaPago,
    setFechaPago,
    metodo,
    setMetodo,
    cobrador,
    setCobrador,
    repartidores,
    clave,
    plan,
    problema,
    revisar,
    previsualizando,
    grabar,
    enviando,
    error: error ?? errorVista,
  };
}
