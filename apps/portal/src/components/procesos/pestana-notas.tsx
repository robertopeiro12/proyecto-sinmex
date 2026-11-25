"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { RecuadroCobro, type ResultadoCobro } from "@/components/cobranza/recuadro-cobro";
import { AnotarFactura } from "@/components/facturas/asignar-factura";
import { BuscarFacturas } from "@/components/facturas/buscar-facturas";
import { Aviso } from "@/components/ui/aviso";
import { Button } from "@/components/ui/button";
import { Casilla, Entrada } from "@/components/ui/campo";
import { Fecha } from "@/components/ui/fecha";
import { FiltroFechas } from "@/components/ui/filtro-fechas";
import { Monto } from "@/components/ui/monto";
import { SelectorSegmentado } from "@/components/ui/selector-segmentado";
import { CajaTabla, Tabla, Td, TdMonto, Th } from "@/components/ui/tabla";
import { Ventana } from "@/components/ui/ventana";
import { DetalleVenta } from "@/components/ventas/detalle-venta";
import { FormularioEditarVenta } from "@/components/ventas/formulario-editar-venta";
import { mensajeDe } from "@/lib/api";
import type { ClienteResumen } from "@/lib/clientes";
import { rangoMes, type RangoFechas } from "@/lib/fechas";
import { formatearPesos, plural } from "@/lib/formato";
import {
  ETIQUETA_STATUS,
  buscarVentas,
  hoyEnTijuana,
  obtenerVenta,
  type FiltroNotas,
  type FiltroVentas,
  type ResultadoBusquedaVentas,
  type VentaDetalle,
  type VentaEncontrada,
} from "@/lib/ventas";

const FILTROS: { valor: FiltroNotas; texto: string }[] = [
  { valor: "con_saldo", texto: "Con saldo" },
  { valor: "por_facturar", texto: "Por facturar" },
  { valor: "todas", texto: "Todas" },
];

/** El # de nota se busca en cualquier fecha: el block de papel no dice cuándo. */
export const DESDE_SIEMPRE = "2020-01-01";

/** Sin espacios y en mayúsculas, como lo compara el servidor. */
function normalizarFolio(texto: string): string {
  return texto.replace(/\s+/g, "").toUpperCase();
}

/** `TJ261124RI03`: sucursal, AAMMDD, vendedor (u `OF`) y operación (ADR-0001). */
export function pareceFolio(texto: string): boolean {
  return /^[A-Z]{2}\d{6}[A-Z0-9]{2}\d{2}$/.test(normalizarFolio(texto));
}

/** Lo que se le pide a `GET /ventas`; `null` = no se puede pedir (falta el cliente). */
export function consultaDeNotas(c: {
  sucursal: string;
  clienteId: string | null;
  busqueda: string | null;
  filtro: FiltroNotas;
  rango: RangoFechas;
  hoy: string;
}): FiltroVentas | null {
  const base: FiltroVentas = { sucursal: c.sucursal, ...(c.clienteId ? { clienteId: c.clienteId } : {}) };
  if (c.busqueda) {
    return pareceFolio(c.busqueda)
      ? { ...base, filtro: "todas", folio: normalizarFolio(c.busqueda) }
      : { ...base, filtro: "todas", numNota: c.busqueda.trim(), desde: DESDE_SIEMPRE, hasta: c.hoy };
  }
  if (c.filtro !== "todas") return c.clienteId ? { ...base, filtro: c.filtro } : null;
  return { ...base, filtro: "todas", desde: c.rango.desde, hasta: c.rango.hasta };
}

/** Con saldo: de la más vieja a la más nueva (el orden en que se cobran). */
function masViejaPrimero(a: VentaEncontrada, b: VentaEncontrada): number {
  if (a.fecha !== b.fecha) return a.fecha < b.fecha ? -1 : 1;
  return a.folio < b.folio ? -1 : a.folio > b.folio ? 1 : 0;
}

function textoFactura(v: VentaEncontrada): string {
  if (v.factura.estado === "facturada") return v.factura.numero ?? "Facturada";
  return v.factura.estado === "pendiente" ? "Pendiente" : "N/A";
}

type Vista = { tipo: "lista" } | { tipo: "detalle"; venta: VentaDetalle } | { tipo: "edicion"; venta: VentaDetalle };
type AvisoNotas = { texto: string; tono: "exito" | "advertencia" };

/**
 * Procesos → Notas (spec D2, boceto de Notas): junta *Ventas*, *Facturas* y
 * *Cobranza*. Las notas del cliente de arriba con filtros Con saldo · Por facturar ·
 * Todas y el buscador de folio o # de nota; sin cliente, solo el buscador o Todas
 * con fechas para toda la sucursal. Las casillas (solo del cliente) abren la barra
 * con Anotar factura y Cobrar; Ver › abre el detalle de siempre aquí mismo.
 *
 * Procesos la monta con `key` del cliente: cambiar de cliente empieza limpio
 * (casillas, recuadro de cobro y detalle; Review Focus 3).
 */
export function PestanaNotas({
  sucursal,
  cliente,
  notaInicial = null,
  busquedaInicial = null,
  onSucio,
  onCambio,
}: {
  sucursal: string;
  cliente: ClienteResumen | null;
  /** Llega palomeada (el Cobrar de Cuentas por Cobrar). */
  notaInicial?: string | null;
  /** Llega buscada (el "Ver en Notas" de Ventas). */
  busquedaInicial?: string | null;
  /** Hay un cobro a medio capturar (Procesos pregunta antes de perderlo). */
  onSucio: (sucio: boolean) => void;
  /** Cambió algo del cliente (cobro, factura, edición): su línea de arriba se recarga. */
  onCambio: () => void;
}) {
  const { puede } = useAuth();
  const hoy = hoyEnTijuana();
  const [texto, setTexto] = useState(busquedaInicial ?? "");
  const [busqueda, setBusqueda] = useState<string | null>(busquedaInicial);
  const [filtro, setFiltro] = useState<FiltroNotas>("con_saldo");
  const [borrador, setBorrador] = useState<RangoFechas>(() => rangoMes(hoy));
  const [rango, setRango] = useState<RangoFechas>(borrador);
  const [recarga, setRecarga] = useState(0);
  const [resultado, setResultado] = useState<ResultadoBusquedaVentas | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seleccion, setSeleccion] = useState<Set<string>>(() => new Set(notaInicial ? [notaInicial] : []));
  // Las notas del cobro abierto, tomadas al abrirlo; `null` = cerrado.
  const [cobro, setCobro] = useState<string[] | null>(null);
  const [anotando, setAnotando] = useState(false);
  const [buscandoFactura, setBuscandoFactura] = useState(false);
  const [aviso, setAviso] = useState<AvisoNotas | null>(null);
  const [vista, setVista] = useState<Vista>({ tipo: "lista" });

  const clienteId = cliente?.id ?? null;
  const consulta = consultaDeNotas({ sucursal, clienteId, busqueda, filtro, rango, hoy });
  const claveConsulta = JSON.stringify(consulta);

  useEffect(() => {
    const pedida: FiltroVentas | null = JSON.parse(claveConsulta);
    if (!pedida) {
      setResultado(null);
      return;
    }
    let vigente = true;
    setCargando(true);
    buscarVentas(pedida)
      .then((r) => {
        if (!vigente) return;
        setResultado(r);
        setError(null);
        // Una casilla de una nota que ya no se ve (la pagaron, cambió el filtro) se suelta.
        setSeleccion((actual) => new Set([...actual].filter((id) => r.ventas.some((v) => v.id === id))));
      })
      .catch((err: unknown) => {
        if (!vigente) return;
        setResultado(null);
        setError(mensajeDe(err, "No se pudieron buscar las notas."));
      })
      .finally(() => {
        if (vigente) setCargando(false);
      });
    return () => {
      vigente = false;
    };
  }, [claveConsulta, recarga]);

  const recargar = () => setRecarga((n) => n + 1);

  const ventas = resultado
    ? !busqueda && filtro === "con_saldo"
      ? [...resultado.ventas].sort(masViejaPrimero)
      : resultado.ventas
    : [];
  // Casillas solo para las notas del cliente elegido.
  const marcables = cliente ? ventas.filter((v) => v.clienteId === cliente.id) : [];
  const marcadas = marcables.filter((v) => seleccion.has(v.id));
  const conSaldo = marcadas.filter((v) => v.saldoCentavos > 0);
  const saldoMarcado = marcadas.reduce((t, v) => t + v.saldoCentavos, 0);
  const todas = marcables.length > 0 && marcadas.length === marcables.length;
  // Con el cobro abierto, nada que lo desmonte o le cambie las notas (revisión T-2, 5).
  const cobrando = cobro !== null;
  const bloqueadas = cargando || cobrando;
  const puedeCobrar = puede("cobranza.registrar");
  const puedeFacturar = puede("venta.asignar_factura");
  const facturables = marcadas.length > 0 && marcadas.every((v) => v.factura.estado === "pendiente");

  function alternar(id: string) {
    setSeleccion((actual) => {
      const nueva = new Set(actual);
      if (nueva.has(id)) nueva.delete(id);
      else nueva.add(id);
      return nueva;
    });
  }

  function buscar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setAviso(null);
    setBusqueda(texto.trim() === "" ? null : texto.trim());
  }

  function elegirFiltro(nuevo: FiltroNotas) {
    setAviso(null);
    setTexto("");
    setBusqueda(null);
    setFiltro(nuevo);
  }

  function terminarCobro(r: ResultadoCobro) {
    setCobro(null);
    onSucio(false);
    setAviso(r);
    if (r.tono === "exito") setSeleccion(new Set());
    recargar();
    onCambio();
  }

  function cancelarCobro() {
    setCobro(null);
    onSucio(false);
  }

  async function abrir(id: string) {
    setError(null);
    try {
      setVista({ tipo: "detalle", venta: await obtenerVenta(id) });
    } catch (err) {
      setError(mensajeDe(err, "No se pudo abrir la nota."));
    }
  }

  function volverALista() {
    setVista({ tipo: "lista" });
    recargar();
    onCambio();
  }

  if (vista.tipo === "edicion") {
    return (
      <FormularioEditarVenta
        venta={vista.venta}
        onGuardada={(actualizada) => setVista({ tipo: "detalle", venta: actualizada })}
        onCancelar={() => setVista({ tipo: "detalle", venta: vista.venta })}
      />
    );
  }

  if (vista.tipo === "detalle") {
    return (
      <DetalleVenta
        venta={vista.venta}
        textoVolver="← Volver a Notas"
        onVolver={volverALista}
        onEditar={() => setVista({ tipo: "edicion", venta: vista.venta })}
        onCambiada={(actualizada) => setVista({ tipo: "detalle", venta: actualizada })}
        onEliminada={volverALista}
      />
    );
  }

  const sinCliente = !busqueda && filtro !== "todas" && !cliente;
  const columnas = 10;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <form onSubmit={buscar} role="search" aria-label="Buscar nota">
          <Entrada
            aria-label="Folio o # de nota"
            placeholder="Folio o # de nota"
            maxLength={30}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            disabled={cobrando}
            className="w-64"
          />
        </form>
        <SelectorSegmentado
          etiqueta="Qué notas"
          opciones={FILTROS}
          valor={busqueda ? ("" as FiltroNotas) : filtro}
          onCambio={elegirFiltro}
          resaltado
          deshabilitado={cobrando}
        />
        {puedeFacturar && (
          <Button
            type="button"
            variant="link"
            className="ml-auto font-semibold text-sucursal"
            disabled={cobrando}
            onClick={() => setBuscandoFactura(true)}
          >
            Buscar factura
          </Button>
        )}
      </div>

      {busqueda && (
        <p className="text-sm text-muted-foreground">
          {pareceFolio(busqueda) ? `Folio ${normalizarFolio(busqueda)}` : `# de nota ${busqueda}, en cualquier fecha`}
          {cliente ? `, de ${cliente.nombre}.` : ", de toda la sucursal."}{" "}
          <button
            type="button"
            className="font-semibold text-sucursal hover:underline disabled:cursor-not-allowed disabled:opacity-50"
            disabled={cobrando}
            onClick={() => {
              setTexto("");
              setBusqueda(null);
            }}
          >
            Quitar búsqueda
          </button>
        </p>
      )}

      {!busqueda && filtro === "todas" && (
        <FiltroFechas
          id="notas"
          desde={borrador.desde}
          hasta={borrador.hasta}
          onCambio={setBorrador}
          onMostrar={(r) => setRango({ ...r })}
          deshabilitado={cargando || cobrando}
        />
      )}

      {aviso && <Aviso tono={aviso.tono}>{aviso.texto}</Aviso>}
      {error && <Aviso tono="error">{error}</Aviso>}

      {sinCliente ? (
        <p className="rounded-[10px] border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
          Elige un cliente arriba.
        </p>
      ) : (
        resultado && (
          <>
            {resultado.hayMas && (
              <Aviso tono="advertencia">Hay más de 200 notas: acota las fechas o elige un cliente.</Aviso>
            )}
            <CajaTabla>
              <Tabla aria-label="Notas" className="min-w-[880px]">
                <thead>
                  <tr>
                    {cliente && (
                      <Th className="w-10">
                        <span className="sr-only">Marcar todas</span>
                        <Casilla
                          aria-label="Marcar todas"
                          checked={todas}
                          disabled={bloqueadas || marcables.length === 0}
                          onChange={() => setSeleccion(todas ? new Set() : new Set(marcables.map((v) => v.id)))}
                        />
                      </Th>
                    )}
                    <Th>Folio</Th>
                    <Th>Fecha</Th>
                    {!cliente && <Th>Cliente</Th>}
                    <Th># nota</Th>
                    <Th>Vendedor</Th>
                    <Th alinear="derecha">Total</Th>
                    <Th alinear="derecha">Saldo</Th>
                    <Th>Status</Th>
                    <Th>Factura</Th>
                    <Th alinear="derecha">
                      <span className="sr-only">Ver</span>
                    </Th>
                  </tr>
                </thead>
                <tbody>
                  {ventas.length === 0 ? (
                    <tr>
                      <td colSpan={columnas} className="px-3 py-6 text-center text-muted-foreground">
                        {!busqueda && filtro === "con_saldo"
                          ? "Este cliente no tiene notas con saldo."
                          : !busqueda && filtro === "por_facturar"
                            ? "Este cliente no tiene notas por facturar."
                            : "No hay notas con esos filtros."}
                      </td>
                    </tr>
                  ) : (
                    ventas.map((v) => (
                      <tr key={v.id} className={seleccion.has(v.id) ? "bg-menu" : undefined}>
                        {cliente && (
                          <Td>
                            {v.clienteId === cliente.id && (
                              <Casilla
                                aria-label={`Marcar ${v.folio}`}
                                checked={seleccion.has(v.id)}
                                disabled={bloqueadas}
                                onChange={() => alternar(v.id)}
                              />
                            )}
                          </Td>
                        )}
                        <Td className="whitespace-nowrap">{v.folio}</Td>
                        <Td>
                          <Fecha valor={v.fecha} />
                        </Td>
                        {!cliente && <Td className="max-w-56 truncate">{v.cliente}</Td>}
                        <Td>{v.numNota ?? "—"}</Td>
                        <Td>{v.repartidor ?? "Oficina"}</Td>
                        <TdMonto centavos={v.montoCentavos} />
                        <Td alinear="derecha" className="whitespace-nowrap">
                          <Monto
                            centavos={v.saldoCentavos}
                            className={v.saldoCentavos > 0 ? "font-semibold text-warning" : undefined}
                          />
                        </Td>
                        <Td>{ETIQUETA_STATUS[v.status]}</Td>
                        <Td>{textoFactura(v)}</Td>
                        <Td alinear="derecha">
                          <button
                            type="button"
                            aria-label={`Ver ${v.folio}`}
                            disabled={cobrando}
                            onClick={() => void abrir(v.id)}
                            className="rounded font-semibold whitespace-nowrap text-sucursal outline-none hover:underline focus-visible:ring-2 focus-visible:ring-sucursal disabled:cursor-not-allowed disabled:opacity-50 disabled:no-underline"
                          >
                            Ver ›
                          </button>
                        </Td>
                      </tr>
                    ))
                  )}
                </tbody>
              </Tabla>
            </CajaTabla>
          </>
        )
      )}

      {cliente && marcadas.length > 0 && (
        <section
          aria-label="Notas marcadas"
          className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border bg-menu px-4 py-3"
        >
          <p className="text-sm">
            <span className="font-semibold">{plural(marcadas.length, "nota", "notas")}</span>
            <span className="ml-3 text-muted-foreground">{`saldo ${formatearPesos(saldoMarcado)}`}</span>
          </p>
          <div className="flex gap-2">
            {puedeFacturar && facturables && (
              <Button type="button" variant="outline" size="lg" disabled={cobrando} onClick={() => setAnotando(true)}>
                Anotar factura
              </Button>
            )}
            {puedeCobrar && conSaldo.length > 0 && cobro === null && (
              <Button
                type="button"
                size="lg"
                onClick={() => {
                  setAviso(null);
                  setCobro(conSaldo.map((v) => v.id));
                }}
              >
                {`Cobrar ${plural(conSaldo.length, "nota", "notas")}…`}
              </Button>
            )}
          </div>
        </section>
      )}

      {cliente && cobro && (
        <RecuadroCobro
          clienteId={cliente.id}
          notaIds={cobro}
          onTerminado={terminarCobro}
          onCancelar={cancelarCobro}
          onSucio={onSucio}
        />
      )}

      {cliente && (
        <Ventana abierta={anotando} alCerrar={() => setAnotando(false)} titulo="Anotar factura">
          <AnotarFactura
            clienteId={cliente.id}
            ventas={marcadas}
            onCancelar={() => setAnotando(false)}
            onAnotada={(mensaje) => {
              setAnotando(false);
              setAviso({ texto: mensaje, tono: "exito" });
              setSeleccion(new Set());
              recargar();
              onCambio();
            }}
          />
        </Ventana>
      )}

      <Ventana
        abierta={buscandoFactura}
        alCerrar={() => {
          setBuscandoFactura(false);
          // Se pudo corregir o quitar una factura: la columna Factura se vuelve a pedir.
          recargar();
        }}
        titulo="Buscar factura"
        ancho="detalle"
      >
        <BuscarFacturas sucursal={sucursal} />
      </Ventana>
    </div>
  );
}
