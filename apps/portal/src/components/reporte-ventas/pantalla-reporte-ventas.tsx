"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/components/auth/auth-provider";
import { mensajeDe } from "@/lib/api";
import { exportarExcel } from "@/lib/excel/exportar";
import { rangoMes, rangoSemana } from "@/lib/fechas";
import { plural } from "@/lib/formato";
import { etiquetaSucursal, formatearFecha } from "@/lib/reportes";
import {
  definicionExcelReporteVentas,
  formatearPiezas,
  obtenerReporteVentas,
  type ReporteVentas,
} from "@/lib/reporte-ventas";
import { listarVendedores, type Vendedor } from "@/lib/vendedores";
import { formatearPesos, hoyEnTijuana } from "@/lib/ventas";
import { ResumenRepartidores, TablaReporteVentas } from "./tabla-reporte-ventas";

/** Lo consultado y con qué filtros: es lo que se exporta. */
interface Consultado {
  reporte: ReporteVentas;
  desde: string;
  hasta: string;
  sucursal: string;
  repartidor: string;
}

/**
 * Operación → Reporte de Ventas (T-49): "resultados por vendedor y por día".
 * La página la monta con `key={sucursal}`: cambiar la sucursal empieza limpio.
 */
export function PantallaReporteVentas({ sucursal }: { sucursal: string | null }) {
  const { puede, usuario, cargando: cargandoSesion } = useAuth();
  const permitido = puede("reporte_ventas.ver");
  const [desde, setDesde] = useState(() => hoyEnTijuana());
  const [hasta, setHasta] = useState(() => hoyEnTijuana());
  const [repartidor, setRepartidor] = useState("");
  const [vendedores, setVendedores] = useState<Vendedor[]>([]);
  const [consultado, setConsultado] = useState<Consultado | null>(null);
  const [cargando, setCargando] = useState(false);
  const [exportando, setExportando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Solo la última consulta escribe: una lenta que llega tarde no pisa a la nueva.
  const ultima = useRef(0);

  useEffect(() => {
    if (!permitido) return;
    let vigente = true;
    listarVendedores(sucursal).then(
      (lista) => {
        if (vigente) setVendedores(lista);
      },
      () => {
        // Sin la lista, el filtro se queda en "Todos" y "Oficina": el reporte sigue sirviendo.
      },
    );
    return () => {
      vigente = false;
    };
  }, [permitido, sucursal]);

  if (cargandoSesion) {
    // Mientras /auth/me no contesta, `puede()` da false a todos (como PantallaKilometraje).
    return (
      <Card>
        <CardHeader>
          <CardTitle>Reporte de Ventas</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Cargando…</p>
        </CardContent>
      </Card>
    );
  }

  if (!permitido) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Reporte de Ventas</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No tienes permiso para ver el reporte de ventas</p>
        </CardContent>
      </Card>
    );
  }

  function aplicar(r: { desde: string; hasta: string }) {
    setDesde(r.desde);
    setHasta(r.hasta);
  }

  // Viendo todas las sucursales, dos vendedores pueden llamarse igual: se distingue con el código.
  const verTodas = !usuario?.sucursal && (sucursal === null || sucursal.toLowerCase() === "todas");
  const nombreVendedor = (v: Vendedor) => (verTodas ? `${v.nombre} · ${v.sucursalCodigo}` : v.nombre);

  function etiquetaRepartidor(valor: string): string {
    if (valor === "") return "Todos";
    if (valor === "oficina") return "Oficina";
    const v = vendedores.find((x) => x.id === valor);
    return v ? nombreVendedor(v) : "Todos";
  }

  async function alMostrar(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (desde > hasta) {
      setError("La fecha inicial no puede ser posterior a la final.");
      return;
    }
    const esta = ++ultima.current;
    const filtroRepartidor = repartidor;
    setCargando(true);
    try {
      const reporte = await obtenerReporteVentas({
        desde,
        hasta,
        sucursal,
        repartidor: filtroRepartidor || null,
      });
      if (esta !== ultima.current) return;
      setConsultado({
        reporte,
        desde,
        hasta,
        sucursal: etiquetaSucursal(usuario?.sucursal?.codigo ?? null, sucursal),
        repartidor: etiquetaRepartidor(filtroRepartidor),
      });
    } catch (err) {
      if (esta !== ultima.current) return;
      setConsultado(null);
      setError(mensajeDe(err, "No se pudo consultar el reporte."));
    } finally {
      if (esta === ultima.current) setCargando(false);
    }
  }

  async function alExportar() {
    if (!consultado) return;
    setError(null);
    setExportando(true);
    try {
      await exportarExcel(
        definicionExcelReporteVentas(consultado.reporte, {
          sucursal: consultado.sucursal,
          repartidor: consultado.repartidor,
        }),
      );
    } catch {
      setError("No se pudo generar el Excel.");
    } finally {
      setExportando(false);
    }
  }

  const hoy = hoyEnTijuana();
  const reporte = consultado?.reporte ?? null;
  const hayVentas = reporte !== null && reporte.dias.length > 0;
  const actualizando = cargando && consultado !== null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Reporte de Ventas</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <form onSubmit={alMostrar} className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="rv-desde" className="text-sm font-medium">
              Desde
            </label>
            <input
              id="rv-desde"
              type="date"
              required
              value={desde}
              onChange={(e) => setDesde(e.target.value)}
              className="rounded-md border px-3 py-2 text-sm"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="rv-hasta" className="text-sm font-medium">
              Hasta
            </label>
            <input
              id="rv-hasta"
              type="date"
              required
              value={hasta}
              onChange={(e) => setHasta(e.target.value)}
              className="rounded-md border px-3 py-2 text-sm"
            />
          </div>
          <div className="flex items-end gap-1">
            <Button type="button" variant="ghost" size="sm" onClick={() => aplicar({ desde: hoy, hasta: hoy })}>
              Hoy
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => aplicar(rangoSemana(hoy))}>
              Esta semana
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => aplicar(rangoMes(hoy))}>
              Este mes
            </Button>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="rv-repartidor" className="text-sm font-medium">
              Repartidor
            </label>
            <select
              id="rv-repartidor"
              value={repartidor}
              onChange={(e) => setRepartidor(e.target.value)}
              className="rounded-md border px-3 py-2 text-sm"
            >
              <option value="">Todos</option>
              <option value="oficina">Oficina</option>
              {vendedores.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.activo ? nombreVendedor(v) : `${nombreVendedor(v)} (inactivo)`}
                </option>
              ))}
            </select>
          </div>
          {/* Siempre activo: se puede corregir un filtro y volver a consultar; la guarda `ultima` descarta lo viejo. */}
          <Button type="submit">Mostrar</Button>
          <Button
            type="button"
            variant="outline"
            disabled={!hayVentas || exportando || cargando}
            onClick={() => void alExportar()}
          >
            Exportar a Excel
          </Button>
        </form>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        {cargando && !consultado && <p className="text-sm text-muted-foreground">Cargando…</p>}
        {actualizando && <p className="text-sm text-muted-foreground">Actualizando…</p>}

        {reporte &&
          (hayVentas ? (
            <div aria-busy={actualizando} className={`flex flex-col gap-5 ${actualizando ? "opacity-60" : ""}`}>
              <p className="text-sm text-muted-foreground">
                {`Del ${formatearFecha(consultado!.desde)} al ${formatearFecha(consultado!.hasta)} · Repartidor: ${consultado!.repartidor} · Sucursal: ${consultado!.sucursal}`}
              </p>
              <p className="text-sm font-medium">
                {`${plural(reporte.total.ventas, "venta", "ventas")} · ${reporte.total.cantidad === 1 ? "1 pieza" : `${formatearPiezas(reporte.total.cantidad)} piezas`} · ${formatearPiezas(reporte.total.promocion)} promo · ${formatearPesos(reporte.total.montoCentavos)}`}
              </p>
              <ResumenRepartidores reporte={reporte} />
              <TablaReporteVentas reporte={reporte} />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No hay ventas en ese rango.</p>
          ))}
      </CardContent>
    </Card>
  );
}
