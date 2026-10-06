"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorApi } from "@/lib/api";
import { listarClientes, type ClienteResumen } from "@/lib/clientes";
import {
  ETIQUETA_ORIGEN,
  ETIQUETA_STATUS,
  buscarVentas,
  formatearPesos,
  hoyEnTijuana,
  obtenerVenta,
  type ResultadoBusquedaVentas,
  type VentaDetalle,
} from "@/lib/ventas";
import { BuscadorCliente } from "./buscador-cliente";
import { DetalleVenta } from "./detalle-venta";
import { FormularioEditarVenta } from "./formulario-editar-venta";

interface Filtro {
  desde: string;
  hasta: string;
  cliente: ClienteResumen | null;
  numNota: string;
}

type Vista =
  | { tipo: "busqueda" }
  | { tipo: "detalle"; venta: VentaDetalle }
  | { tipo: "edicion"; venta: VentaDetalle };

function filtroDeHoy(): Filtro {
  const hoy = hoyEnTijuana();
  return { desde: hoy, hasta: hoy, cliente: null, numNota: "" };
}

function mensajeDe(err: unknown, porDefecto: string): string {
  return err instanceof ErrorApi && err.mensajeApi ? err.mensajeApi : porDefecto;
}

/**
 * Ventas (T-17, parte 2, §3): buscar por rango de fechas, cliente y # de nota;
 * ver el detalle; editar, eliminar o marcar como cuenta perdida. Vale para las
 * ventas de la tablet y del portal.
 *
 * Los filtros viven aquí y no en la vista de búsqueda: así "Volver" regresa
 * con los mismos filtros y vuelve a buscar (la venta pudo cambiar).
 */
export function PantallaVentas({ sucursal }: { sucursal: string | null }) {
  const [clientes, setClientes] = useState<ClienteResumen[]>([]);
  const [borrador, setBorrador] = useState<Filtro>(filtroDeHoy);
  const [aplicado, setAplicado] = useState<Filtro>(filtroDeHoy);
  const [resultado, setResultado] = useState<ResultadoBusquedaVentas | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [vista, setVista] = useState<Vista>({ tipo: "busqueda" });

  useEffect(() => {
    let vigente = true;
    listarClientes(sucursal, "todos")
      .then((lista) => {
        if (vigente) setClientes(lista);
      })
      .catch(() => {
        if (vigente) setError("No se pudieron cargar los clientes.");
      });
    return () => {
      vigente = false;
    };
  }, [sucursal]);

  // Cada `setAplicado` (Buscar, Volver) es un objeto nuevo: vuelve a buscar.
  useEffect(() => {
    let vigente = true;
    setCargando(true);
    buscarVentas({
      desde: aplicado.desde,
      hasta: aplicado.hasta,
      sucursal,
      clienteId: aplicado.cliente?.id ?? null,
      numNota: aplicado.numNota,
    })
      .then((r) => {
        if (!vigente) return;
        setResultado(r);
        setError(null);
      })
      .catch((err: unknown) => {
        if (vigente) setError(mensajeDe(err, "No se pudieron buscar las ventas."));
      })
      .finally(() => {
        if (vigente) setCargando(false);
      });
    return () => {
      vigente = false;
    };
  }, [aplicado, sucursal]);

  function alBuscar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setAplicado({ ...borrador });
  }

  function volverABusqueda() {
    setVista({ tipo: "busqueda" });
    setAplicado((actual) => ({ ...actual }));
  }

  async function abrir(id: string) {
    setError(null);
    try {
      setVista({ tipo: "detalle", venta: await obtenerVenta(id) });
    } catch (err) {
      setError(mensajeDe(err, "No se pudo abrir la venta."));
    }
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
        onVolver={volverABusqueda}
        onEditar={() => setVista({ tipo: "edicion", venta: vista.venta })}
        onCambiada={(actualizada) => setVista({ tipo: "detalle", venta: actualizada })}
        onEliminada={volverABusqueda}
      />
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Ventas</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <form onSubmit={alBuscar} className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="desde" className="text-sm font-medium">
              Desde
            </label>
            <input
              id="desde"
              type="date"
              required
              value={borrador.desde}
              onChange={(e) => setBorrador({ ...borrador, desde: e.target.value })}
              className="rounded-md border px-3 py-2 text-sm"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="hasta" className="text-sm font-medium">
              Hasta
            </label>
            <input
              id="hasta"
              type="date"
              required
              value={borrador.hasta}
              onChange={(e) => setBorrador({ ...borrador, hasta: e.target.value })}
              className="rounded-md border px-3 py-2 text-sm"
            />
          </div>
          <BuscadorCliente
            clientes={clientes}
            cliente={borrador.cliente}
            onElegir={(cliente) => setBorrador({ ...borrador, cliente })}
            onQuitar={() => setBorrador({ ...borrador, cliente: null })}
            etiquetaQuitar="Quitar"
          />
          <div className="flex flex-col gap-1.5">
            <label htmlFor="buscar-num-nota" className="text-sm font-medium">
              # de nota
            </label>
            <input
              id="buscar-num-nota"
              maxLength={30}
              value={borrador.numNota}
              onChange={(e) => setBorrador({ ...borrador, numNota: e.target.value })}
              className="w-40 rounded-md border px-3 py-2 text-sm"
            />
          </div>
          <Button type="submit" disabled={cargando}>
            Buscar
          </Button>
        </form>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        {resultado?.hayMas && (
          <p className="text-sm text-muted-foreground">
            Hay más de 200 ventas: acota el rango o filtra por cliente.
          </p>
        )}

        {resultado && resultado.ventas.length === 0 && (
          <p className="text-sm text-muted-foreground">No hay ventas con esos filtros.</p>
        )}

        {resultado && resultado.ventas.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="py-1 font-medium">Folio</th>
                <th className="py-1 font-medium">Fecha</th>
                <th className="py-1 font-medium">Cliente</th>
                <th className="py-1 font-medium">Repartidor</th>
                <th className="py-1 font-medium"># de nota</th>
                <th className="py-1 text-right font-medium">Monto</th>
                <th className="py-1 font-medium">Status</th>
                <th className="py-1 font-medium">Origen</th>
                <th className="py-1 text-right font-medium">Saldo</th>
              </tr>
            </thead>
            <tbody>
              {resultado.ventas.map((v) => (
                <tr key={v.id} className="border-t">
                  <td className="py-1.5">
                    <button
                      type="button"
                      onClick={() => void abrir(v.id)}
                      className="font-mono underline-offset-2 hover:underline"
                    >
                      {v.folio}
                    </button>
                  </td>
                  <td className="py-1.5">{v.fecha}</td>
                  <td className="py-1.5">{v.cliente}</td>
                  <td className="py-1.5">{v.repartidor ?? "Oficina"}</td>
                  <td className="py-1.5">{v.numNota}</td>
                  <td className="py-1.5 text-right">{formatearPesos(v.montoCentavos)}</td>
                  <td className="py-1.5">{ETIQUETA_STATUS[v.status]}</td>
                  <td className="py-1.5">{ETIQUETA_ORIGEN[v.origen]}</td>
                  <td className="py-1.5 text-right">{formatearPesos(v.saldoCentavos)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}
