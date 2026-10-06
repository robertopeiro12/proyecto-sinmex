"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/components/auth/auth-provider";
import { useEnvioFormulario } from "@/components/catalogo/use-envio-formulario";
import { ErrorApi } from "@/lib/api";
import { listarClientes, obtenerCliente, type ClienteResumen } from "@/lib/clientes";
import {
  formatearPesos,
  hoyEnTijuana,
  leerPiezas,
  listarRepartidores,
  obtenerCatalogoVenta,
  registrarVenta,
  type ContadoCredito,
  type FacturaVenta,
  type MetodoPagoContado,
  type NuevaVenta,
  type PresentacionDeCatalogo,
  type Repartidor,
  type VentaRegistrada,
} from "@/lib/ventas";

/** Valor del desplegable para la venta de mostrador: viaja como `vendedorId: null`. */
const OFICINA = "oficina";

const ETIQUETA_STATUS: Record<VentaRegistrada["status"], string> = {
  pagada: "Pagada",
  pendiente: "Pendiente",
  promocion: "Promoción",
};

type Captura = Record<string, { cantidad: string; promocion: string }>;

/** Sin acentos ni mayúsculas, para buscar "jose" y encontrar "José". */
function normalizar(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/**
 * Registrar venta desde el portal (T-17, parte 1, §3 del spec).
 *
 * El precio no se teclea: sale del catálogo del cliente a la fecha
 * (`GET /ventas/catalogo`) y el servidor lo vuelve a resolver al grabar. El
 * total de aquí es solo una vista previa.
 */
export function PantallaRegistrarVenta({ sucursal }: { sucursal: string | null }) {
  const { puede } = useAuth();
  const puedeRegistrar = puede("venta.registrar");

  const [fecha, setFecha] = useState(() => hoyEnTijuana());
  const [clientes, setClientes] = useState<ClienteResumen[]>([]);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState("");
  const [cliente, setCliente] = useState<ClienteResumen | null>(null);
  const [repartidores, setRepartidores] = useState<Repartidor[]>([]);
  const [repartidor, setRepartidor] = useState("");
  const [catalogo, setCatalogo] = useState<PresentacionDeCatalogo[]>([]);
  const [captura, setCaptura] = useState<Captura>({});
  const [numNota, setNumNota] = useState("");
  const [contadoCredito, setContadoCredito] = useState<ContadoCredito>("contado");
  const [metodoPago, setMetodoPago] = useState<MetodoPagoContado>("transferencia");
  const [factura, setFactura] = useState<FacturaVenta>("N/A");
  const [comentarios, setComentarios] = useState("");
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
        if (vigente) setCatalogo(lista);
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

  const coincidencias = useMemo(() => {
    const q = normalizar(busqueda.trim());
    if (q === "") return [];
    return clientes.filter((c) => normalizar(c.nombre).includes(q)).slice(0, 10);
  }, [busqueda, clientes]);

  // Solo cuentan las presentaciones con precio: una deshabilitada nunca suma ni viaja.
  const totalCentavos = catalogo.reduce((total, p) => {
    if (p.precioCentavos === null) return total;
    const piezas = leerPiezas(captura[p.presentacionId]?.cantidad ?? "");
    return total + (piezas ?? 0) * p.precioCentavos;
  }, 0);

  function elegirCliente(elegido: ClienteResumen) {
    setCliente(elegido);
    setBusqueda("");
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

  function cambiarCaptura(presentacionId: string, campo: "cantidad" | "promocion", valor: string) {
    setCaptura((actual) => ({
      ...actual,
      [presentacionId]: {
        cantidad: actual[presentacionId]?.cantidad ?? "",
        promocion: actual[presentacionId]?.promocion ?? "",
        [campo]: valor,
      },
    }));
  }

  function registrarOtra() {
    setCliente(null);
    setBusqueda("");
    setRepartidores([]);
    setRepartidor("");
    setCatalogo([]);
    setCaptura({});
    setNumNota("");
    setContadoCredito("contado");
    setMetodoPago("transferencia");
    setFactura("N/A");
    setComentarios("");
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

    const lineas: NuevaVenta["lineas"] = [];
    for (const p of catalogo) {
      if (p.precioCentavos === null) continue;
      const cantidad = leerPiezas(captura[p.presentacionId]?.cantidad ?? "");
      const promocion = leerPiezas(captura[p.presentacionId]?.promocion ?? "");
      if (cantidad === null || promocion === null) {
        setErrorLocal("Las cantidades deben ser números enteros de 0 en adelante.");
        return;
      }
      if (cantidad + promocion > 0) {
        lineas.push({ presentacionId: p.presentacionId, cantidad, cantidadPromocion: promocion });
      }
    }
    if (lineas.length === 0) {
      setErrorLocal("Captura al menos un producto.");
      return;
    }

    const comentario = comentarios.trim();
    const venta: NuevaVenta = {
      fecha,
      clienteId: cliente.id,
      vendedorId: repartidor === OFICINA ? null : repartidor,
      numNota: numNota.trim(),
      contadoCredito,
      ...(contadoCredito === "contado" ? { metodoPago } : {}),
      factura,
      ...(comentario ? { comentarios: comentario } : {}),
      lineas,
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
          {errorCarga && (
            <p className="text-sm text-destructive">{errorCarga}</p>
          )}

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

            <div className="flex min-w-72 flex-1 flex-col gap-1.5">
              <label htmlFor="buscar-cliente" className="text-sm font-medium">
                Cliente
              </label>
              {cliente ? (
                <div className="flex items-center gap-2 text-sm">
                  <span>
                    {cliente.nombre} · {cliente.sucursalCodigo}
                    {cliente.tipo === "prospecto" ? " · Prospecto" : ""}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={enviando}
                    onClick={quitarCliente}
                  >
                    Cambiar
                  </Button>
                </div>
              ) : (
                <>
                  <input
                    id="buscar-cliente"
                    autoComplete="off"
                    placeholder="Escribe el nombre del cliente"
                    value={busqueda}
                    onChange={(e) => setBusqueda(e.target.value)}
                    className="rounded-md border px-3 py-2 text-sm"
                  />
                  {coincidencias.length > 0 && (
                    <ul className="flex flex-col rounded-md border">
                      {coincidencias.map((c) => (
                        <li key={c.id}>
                          <button
                            type="button"
                            onClick={() => elegirCliente(c)}
                            className="w-full px-3 py-1.5 text-left text-sm hover:bg-accent"
                          >
                            {c.nombre} · {c.sucursalCodigo}
                            {c.tipo === "prospecto" ? " · Prospecto" : ""}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="repartidor" className="text-sm font-medium">
                Repartidor
              </label>
              <select
                id="repartidor"
                disabled={enviando || !cliente}
                value={repartidor}
                onChange={(e) => setRepartidor(e.target.value)}
                className="w-64 rounded-md border px-3 py-2 text-sm"
              >
                <option value="">Elige…</option>
                {repartidores.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.nombre}
                  </option>
                ))}
                <option value={OFICINA}>Oficina</option>
              </select>
            </div>
          </div>

          {cliente && (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="py-1 font-medium">Producto</th>
                  <th className="py-1 font-medium">Precio</th>
                  <th className="py-1 font-medium">Cantidad</th>
                  <th className="py-1 font-medium">Promoción</th>
                  <th className="py-1 text-right font-medium">Subtotal</th>
                </tr>
              </thead>
              <tbody>
                {catalogo.map((p) => {
                  const nombre = `${p.producto} ${p.volumen}`;
                  const sinPrecio = p.precioCentavos === null;
                  const piezas = leerPiezas(captura[p.presentacionId]?.cantidad ?? "") ?? 0;
                  return (
                    <tr key={p.presentacionId} className="border-t">
                      <td className="py-1.5">{nombre}</td>
                      <td className="py-1.5">
                        {sinPrecio ? (
                          <span className="text-muted-foreground">sin precio en la lista</span>
                        ) : (
                          formatearPesos(p.precioCentavos ?? 0)
                        )}
                      </td>
                      <td className="py-1.5">
                        <input
                          aria-label={`Cantidad de ${nombre}`}
                          type="number"
                          min={0}
                          step="any"
                          inputMode="numeric"
                          disabled={sinPrecio || enviando}
                          value={captura[p.presentacionId]?.cantidad ?? ""}
                          onChange={(e) => cambiarCaptura(p.presentacionId, "cantidad", e.target.value)}
                          className="w-24 rounded-md border px-2 py-1"
                        />
                      </td>
                      <td className="py-1.5">
                        <input
                          aria-label={`Promoción de ${nombre}`}
                          type="number"
                          min={0}
                          step="any"
                          inputMode="numeric"
                          disabled={sinPrecio || enviando}
                          value={captura[p.presentacionId]?.promocion ?? ""}
                          onChange={(e) => cambiarCaptura(p.presentacionId, "promocion", e.target.value)}
                          className="w-24 rounded-md border px-2 py-1"
                        />
                      </td>
                      <td className="py-1.5 text-right">
                        {sinPrecio ? "—" : formatearPesos(piezas * (p.precioCentavos ?? 0))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          <p className="text-right text-base font-semibold">Total: {formatearPesos(totalCentavos)}</p>

          <div className="flex flex-wrap gap-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="num-nota" className="text-sm font-medium">
                Número de nota
              </label>
              <input
                id="num-nota"
                required
                maxLength={30}
                disabled={enviando}
                value={numNota}
                onChange={(e) => setNumNota(e.target.value)}
                className="w-40 rounded-md border px-3 py-2 text-sm"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="contado-credito" className="text-sm font-medium">
                Contado o crédito
              </label>
              <select
                id="contado-credito"
                disabled={enviando}
                value={contadoCredito}
                onChange={(e) => setContadoCredito(e.target.value as ContadoCredito)}
                className="rounded-md border px-3 py-2 text-sm"
              >
                <option value="contado">Contado</option>
                <option value="credito">Crédito</option>
              </select>
            </div>

            {contadoCredito === "contado" && (
              <div className="flex flex-col gap-1.5">
                <label htmlFor="metodo-pago" className="text-sm font-medium">
                  Método de pago
                </label>
                <select
                  id="metodo-pago"
                  disabled={enviando}
                  value={metodoPago}
                  onChange={(e) => setMetodoPago(e.target.value as MetodoPagoContado)}
                  className="rounded-md border px-3 py-2 text-sm"
                >
                  <option value="transferencia">Transferencia</option>
                  <option value="efectivo">Efectivo</option>
                </select>
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <label htmlFor="factura" className="text-sm font-medium">
                Factura
              </label>
              <select
                id="factura"
                disabled={enviando}
                value={factura}
                onChange={(e) => setFactura(e.target.value as FacturaVenta)}
                className="rounded-md border px-3 py-2 text-sm"
              >
                <option value="N/A">N/A</option>
                <option value="pendiente">Pendiente</option>
              </select>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="comentarios" className="text-sm font-medium">
              Comentarios
            </label>
            <textarea
              id="comentarios"
              maxLength={500}
              disabled={enviando}
              value={comentarios}
              onChange={(e) => setComentarios(e.target.value)}
              className="rounded-md border px-3 py-2 text-sm"
            />
          </div>

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
