"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useEnvioFormulario } from "@/components/catalogo/use-envio-formulario";
import {
  REPARTIDOR_OFICINA,
  camposDeCondiciones,
  capturaDeLineas,
  conCaptura,
  condicionesDeVenta,
  editarVenta,
  filasDeEdicion,
  formatearPesos,
  lineasDeCaptura,
  listarRepartidores,
  obtenerCatalogoVenta,
  totalDeCaptura,
  type Captura,
  type CondicionesVenta,
  type PresentacionDeCatalogo,
  type Repartidor,
  type VentaDetalle,
} from "@/lib/ventas";
import { CamposCondicionesVenta } from "./campos-condiciones-venta";
import { SelectorRepartidor } from "./selector-repartidor";
import { TablaProductosVenta } from "./tabla-productos-venta";

/**
 * Editar una venta (T-17, parte 2, §3.3): el mismo formulario que "Registrar
 * venta" con el cliente y la fecha fijos. Las líneas existentes muestran su
 * precio guardado; las presentaciones nuevas, el de la lista a la fecha de la
 * venta. El servidor vuelve a resolver todo al grabar.
 */
export function FormularioEditarVenta({
  venta,
  onGuardada,
  onCancelar,
}: {
  venta: VentaDetalle;
  onGuardada: (actualizada: VentaDetalle) => void;
  onCancelar: () => void;
}) {
  const [catalogo, setCatalogo] = useState<PresentacionDeCatalogo[]>([]);
  const [repartidores, setRepartidores] = useState<Repartidor[]>([]);
  const [cargado, setCargado] = useState(false);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [repartidor, setRepartidor] = useState(venta.vendedorId ?? REPARTIDOR_OFICINA);
  const [captura, setCaptura] = useState<Captura>(() => capturaDeLineas(venta.lineas));
  const [condiciones, setCondiciones] = useState<CondicionesVenta>(() => condicionesDeVenta(venta));
  const [errorLocal, setErrorLocal] = useState<string | null>(null);
  const { enviando, error, enviar } = useEnvioFormulario("No se pudo guardar la venta.");

  useEffect(() => {
    let vigente = true;
    Promise.all([
      obtenerCatalogoVenta(venta.clienteId, venta.fecha),
      listarRepartidores(venta.sucursalId),
    ])
      .then(([lista, activos]) => {
        if (!vigente) return;
        setCatalogo(lista);
        setRepartidores(activos);
        setCargado(true);
      })
      .catch(() => {
        if (vigente) setErrorCarga("No se pudieron cargar los productos y repartidores de la venta.");
      });
    return () => {
      vigente = false;
    };
  }, [venta.clienteId, venta.fecha, venta.sucursalId]);

  const filas = useMemo(() => filasDeEdicion(venta.lineas, catalogo), [venta.lineas, catalogo]);
  const totalCentavos = totalDeCaptura(filas, captura);

  // El repartidor actual pudo darse de baja: se conserva como opción para no
  // cambiárselo sin querer (el servidor no lo re-valida si no cambia).
  const opciones = useMemo(() => {
    const actual = venta.vendedorId;
    if (actual === null || repartidores.some((r) => r.id === actual)) return repartidores;
    const nombre = venta.repartidor ?? "Vendedor";
    return [...repartidores, { id: actual, nombre: cargado ? `${nombre} (inactivo)` : nombre }];
  }, [repartidores, cargado, venta.vendedorId, venta.repartidor]);

  async function alEnviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setErrorLocal(null);
    if (repartidor === "") {
      setErrorLocal("Elige el repartidor.");
      return;
    }
    const armadas = lineasDeCaptura(filas, captura);
    if (!armadas.ok) {
      setErrorLocal(armadas.error);
      return;
    }
    await enviar(
      async () => {
        onGuardada(
          await editarVenta(venta.id, {
            vendedorId: repartidor === REPARTIDOR_OFICINA ? null : repartidor,
            ...camposDeCondiciones(condiciones),
            lineas: armadas.lineas,
          }),
        );
      },
      () => {},
    );
  }

  const mensajeError = errorLocal ?? error;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Editar venta {venta.folio}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={alEnviar} className="flex flex-col gap-5">
          {errorCarga && <p className="text-sm text-destructive">{errorCarga}</p>}

          <div className="flex flex-wrap gap-4">
            <div className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium">Fecha</span>
              <span>{venta.fecha}</span>
            </div>
            <div className="flex min-w-72 flex-1 flex-col gap-1.5 text-sm">
              <span className="font-medium">Cliente</span>
              <span>
                {venta.cliente} · {venta.sucursalCodigo}
              </span>
            </div>
            <SelectorRepartidor
              repartidores={opciones}
              valor={repartidor}
              onCambio={setRepartidor}
              disabled={enviando}
              conOficina={venta.origen === "portal"}
            />
          </div>

          <TablaProductosVenta
            filas={filas}
            captura={captura}
            onCambio={(id, campo, valor) => setCaptura((actual) => conCaptura(actual, id, campo, valor))}
            disabled={enviando}
          />

          <p className="text-right text-base font-semibold">Total: {formatearPesos(totalCentavos)}</p>

          <CamposCondicionesVenta
            valores={condiciones}
            onCambio={(cambio) => setCondiciones((actual) => ({ ...actual, ...cambio }))}
            disabled={enviando}
          />

          {mensajeError && (
            <p role="alert" className="text-sm text-destructive">
              {mensajeError}
            </p>
          )}

          <div className="flex gap-2">
            <Button type="submit" disabled={enviando}>
              {enviando ? "Guardando…" : "Guardar"}
            </Button>
            <Button type="button" variant="outline" disabled={enviando} onClick={onCancelar}>
              Cancelar
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
