"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/components/auth/auth-provider";
import { useEnvioFormulario } from "@/components/catalogo/use-envio-formulario";
import { ErrorApi } from "@/lib/api";
import { listarClientes, obtenerCliente, type ClienteResumen } from "@/lib/clientes";
import {
  CONDICIONES_INICIALES,
  ETIQUETA_STATUS,
  REPARTIDOR_OFICINA,
  camposDeCondiciones,
  conCaptura,
  filasDeCatalogo,
  formatearPesos,
  hoyEnTijuana,
  lineasDeCaptura,
  listarRepartidores,
  obtenerCatalogoVenta,
  registrarVenta,
  totalDeCaptura,
  type Captura,
  type CondicionesVenta,
  type NuevaVenta,
  type PresentacionDeCatalogo,
  type Repartidor,
  type VentaRegistrada,
} from "@/lib/ventas";
import { BuscadorCliente } from "./buscador-cliente";
import { CamposCondicionesVenta } from "./campos-condiciones-venta";
import { SelectorRepartidor } from "./selector-repartidor";
import { TablaProductosVenta } from "./tabla-productos-venta";

/**
 * Registrar venta desde el portal (T-17, parte 1, §3 del spec).
 *
 * El precio no se teclea: sale del catálogo del cliente a la fecha
 * (`GET /ventas/catalogo`) y el servidor lo vuelve a resolver al grabar. El
 * total de aquí es solo una vista previa. La tabla, las condiciones y las
 * reglas del payload son las mismas que usa "Editar venta" (parte 2).
 */
export function PantallaRegistrarVenta({ sucursal }: { sucursal: string | null }) {
  const { puede } = useAuth();
  const puedeRegistrar = puede("venta.registrar");

  const [fecha, setFecha] = useState(() => hoyEnTijuana());
  const [clientes, setClientes] = useState<ClienteResumen[]>([]);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [cliente, setCliente] = useState<ClienteResumen | null>(null);
  const [repartidores, setRepartidores] = useState<Repartidor[]>([]);
  const [repartidor, setRepartidor] = useState("");
  const [catalogo, setCatalogo] = useState<PresentacionDeCatalogo[]>([]);
  const [captura, setCaptura] = useState<Captura>({});
  const [condiciones, setCondiciones] = useState<CondicionesVenta>(CONDICIONES_INICIALES);
  const [errorLocal, setErrorLocal] = useState<string | null>(null);
  const [resultado, setResultado] = useState<VentaRegistrada | null>(null);
  const { enviando, error, enviar } = useEnvioFormulario("No se pudo registrar la venta.");

  // Clientes y prospectos del alcance (el backend acota por sucursal).
  useEffect(() => {
    let vigente = true;
    listarClientes(sucursal, "todos")
      .then((lista) => {
        if (vigente) setClientes(lista);
      })
      .catch(() => {
        if (vigente) setErrorCarga("No se pudieron cargar los clientes.");
      });
    return () => {
      vigente = false;
    };
  }, [sucursal]);

  // Repartidores: la sucursal sale del DETALLE (la fila de la lista solo trae el código).
  useEffect(() => {
    if (!cliente) return;
    let vigente = true;
    obtenerCliente(cliente.id)
      .then((detalle) => listarRepartidores(detalle.sucursalId))
      .then((lista) => {
        if (vigente) setRepartidores(lista);
      })
      .catch(() => {
        if (vigente) setErrorCarga("No se pudieron cargar los repartidores.");
      });
    return () => {
      vigente = false;
    };
  }, [cliente]);

  // Productos con el precio de ESA fecha. `vigente` descarta una respuesta vieja
  // si la fecha cambia antes de que llegue.
  useEffect(() => {
    if (!cliente || !fecha) return;
    let vigente = true;
    obtenerCatalogoVenta(cliente.id, fecha)
      .then((lista) => {
        if (!vigente) return;
        setCatalogo(lista);
        setErrorCarga(null);
      })
      .catch((err: unknown) => {
        if (!vigente) return;
        setCatalogo([]);
        setErrorCarga(
          err instanceof ErrorApi && err.mensajeApi
            ? err.mensajeApi
            : "No se pudieron cargar los productos del cliente.",
        );
      });
    return () => {
      vigente = false;
    };
  }, [cliente, fecha]);

  // Solo cuentan las presentaciones con precio: una deshabilitada nunca suma ni viaja.
  const filas = useMemo(() => filasDeCatalogo(catalogo), [catalogo]);
  const totalCentavos = totalDeCaptura(filas, captura);

  function elegirCliente(elegido: ClienteResumen) {
    setCliente(elegido);
    setRepartidor("");
    setRepartidores([]);
    setCatalogo([]);
    setCaptura({});
    setErrorCarga(null);
  }

  /** Sin cliente no hay catalogo ni repartidores: nada viejo puede sumar al total. */
  function quitarCliente() {
    setCliente(null);
    setRepartidor("");
    setRepartidores([]);
    setCatalogo([]);
    setCaptura({});
  }

  function registrarOtra() {
    setCliente(null);
    setRepartidores([]);
    setRepartidor("");
    setCatalogo([]);
    setCaptura({});
    setCondiciones(CONDICIONES_INICIALES);
    setErrorLocal(null);
    setResultado(null);
  }

  async function alEnviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setErrorLocal(null);
    if (!cliente) {
      setErrorLocal("Elige el cliente.");
      return;
    }
    if (repartidor === "") {
      setErrorLocal("Elige el repartidor, u Oficina.");
      return;
    }
    const armadas = lineasDeCaptura(filas, captura);
    if (!armadas.ok) {
      setErrorLocal(armadas.error);
      return;
    }

    const venta: NuevaVenta = {
      fecha,
      clienteId: cliente.id,
      vendedorId: repartidor === REPARTIDOR_OFICINA ? null : repartidor,
      ...camposDeCondiciones(condiciones),
      lineas: armadas.lineas,
    };
    await enviar(
      async () => {
        setResultado(await registrarVenta(venta));
      },
      () => {},
    );
  }

  if (resultado) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Registrar venta</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div role="status" className="rounded-md border p-4 text-sm">
            <p className="font-semibold">Venta registrada</p>
            <p>
              Folio <span className="font-mono">{resultado.folio}</span> ·{" "}
              {formatearPesos(resultado.montoCentavos)} · {ETIQUETA_STATUS[resultado.status]}
            </p>
            <p className="text-muted-foreground">
              Si hay nota de papel, anota el folio en ella.
            </p>
          </div>
          <div>
            <Button onClick={registrarOtra}>Registrar otra</Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  const mensajeError = errorLocal ?? error;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Registrar venta</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={alEnviar} className="flex flex-col gap-5">
          {errorCarga && <p className="text-sm text-destructive">{errorCarga}</p>}

          <div className="flex flex-wrap gap-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="fecha" className="text-sm font-medium">
                Fecha
              </label>
              <input
                id="fecha"
                type="date"
                required
                max={hoyEnTijuana()}
                disabled={enviando}
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
                className="rounded-md border px-3 py-2 text-sm"
              />
            </div>

            <BuscadorCliente
              clientes={clientes}
              cliente={cliente}
              onElegir={elegirCliente}
              onQuitar={quitarCliente}
              disabled={enviando}
            />

            <SelectorRepartidor
              repartidores={repartidores}
              valor={repartidor}
              onCambio={setRepartidor}
              disabled={enviando || !cliente}
              conOficina
            />
          </div>

          {cliente && (
            <TablaProductosVenta
              filas={filas}
              captura={captura}
              onCambio={(id, campo, valor) => setCaptura((actual) => conCaptura(actual, id, campo, valor))}
              disabled={enviando}
            />
          )}

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

          {puedeRegistrar ? (
            <div>
              <Button type="submit" disabled={enviando}>
                {enviando ? "Grabando…" : "Grabar"}
              </Button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No tienes permiso para registrar ventas.
            </p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
