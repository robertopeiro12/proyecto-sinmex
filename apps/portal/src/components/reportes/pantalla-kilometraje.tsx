"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/components/auth/auth-provider";
import { mensajeDe } from "@/lib/api";
import { exportarExcel } from "@/lib/excel/exportar";
import {
  definicionExcelKilometraje,
  etiquetaSucursal,
  etiquetaVehiculo,
  obtenerReporteKilometraje,
  primerDiaDelMes,
  type ReporteKilometraje,
} from "@/lib/reportes";
import { listarVehiculos, type Vehiculo } from "@/lib/vehiculos";
import { hoyEnTijuana } from "@/lib/ventas";
import { TablaKilometraje } from "./tabla-kilometraje";

/** Lo que se consulto y con que filtros: es lo que se exporta (Review Focus 5). */
interface Consultado {
  reporte: ReporteKilometraje;
  sucursal: string;
  vehiculo: string;
}

/**
 * Información → Reportes → Kilometraje (T-50). La pagina monta este componente
 * con `key={sucursal}`: cambiar el selector global de sucursal empieza limpio.
 */
export function PantallaKilometraje({ sucursal }: { sucursal: string | null }) {
  const { puede, usuario } = useAuth();
  const permitido = puede("reportes.ver");
  const [desde, setDesde] = useState(() => primerDiaDelMes(hoyEnTijuana()));
  const [hasta, setHasta] = useState(() => hoyEnTijuana());
  const [vehiculoId, setVehiculoId] = useState("");
  const [vehiculos, setVehiculos] = useState<Vehiculo[]>([]);
  const [consultado, setConsultado] = useState<Consultado | null>(null);
  const [cargando, setCargando] = useState(false);
  const [exportando, setExportando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Una consulta lenta que llega tarde no pisa a la mas nueva.
  const ultimaConsulta = useRef(0);

  useEffect(() => {
    if (!permitido) return;
    let vigente = true;
    listarVehiculos(sucursal).then(
      (lista) => {
        if (vigente) setVehiculos(lista);
      },
      () => {
        // Sin la lista, el filtro se queda en "Todos": el reporte sigue sirviendo.
      },
    );
    return () => {
      vigente = false;
    };
  }, [permitido, sucursal]);

  if (!permitido) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Reporte de Kilometraje</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No tienes permiso para ver reportes</p>
        </CardContent>
      </Card>
    );
  }

  async function alConsultar(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (desde > hasta) {
      setError("La fecha inicial no puede ser posterior a la final.");
      return;
    }
    const esta = ++ultimaConsulta.current;
    setCargando(true);
    try {
      const reporte = await obtenerReporteKilometraje({
        desde,
        hasta,
        vehiculoId: vehiculoId || null,
        sucursal,
      });
      if (esta !== ultimaConsulta.current) return;
      const elegido = vehiculos.find((v) => v.id === vehiculoId);
      setConsultado({
        reporte,
        sucursal: etiquetaSucursal(usuario?.sucursal?.codigo ?? null, sucursal),
        vehiculo: elegido ? etiquetaVehiculo(elegido) : "Todos",
      });
    } catch (err) {
      if (esta !== ultimaConsulta.current) return;
      setConsultado(null);
      setError(mensajeDe(err, "No se pudo consultar el reporte."));
    } finally {
      if (esta === ultimaConsulta.current) setCargando(false);
    }
  }

  async function alExportar() {
    if (!consultado) return;
    setError(null);
    setExportando(true);
    try {
      await exportarExcel(
        definicionExcelKilometraje(consultado.reporte, {
          sucursal: consultado.sucursal,
          vehiculo: consultado.vehiculo,
        }),
      );
    } catch {
      setError("No se pudo generar el Excel.");
    } finally {
      setExportando(false);
    }
  }

  const hayResultados = consultado !== null && consultado.reporte.vehiculos.length > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Reporte de Kilometraje</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <form onSubmit={alConsultar} className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="km-desde" className="text-sm font-medium">
              Desde
            </label>
            <input
              id="km-desde"
              type="date"
              required
              value={desde}
              onChange={(e) => setDesde(e.target.value)}
              className="rounded-md border px-3 py-2 text-sm"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="km-hasta" className="text-sm font-medium">
              Hasta
            </label>
            <input
              id="km-hasta"
              type="date"
              required
              value={hasta}
              onChange={(e) => setHasta(e.target.value)}
              className="rounded-md border px-3 py-2 text-sm"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="km-vehiculo" className="text-sm font-medium">
              Vehículo
            </label>
            <select
              id="km-vehiculo"
              value={vehiculoId}
              onChange={(e) => setVehiculoId(e.target.value)}
              className="rounded-md border px-3 py-2 text-sm"
            >
              <option value="">Todos</option>
              {vehiculos.map((v) => (
                <option key={v.id} value={v.id}>
                  {etiquetaVehiculo(v)}
                </option>
              ))}
            </select>
          </div>
          <Button type="submit" disabled={cargando}>
            Consultar
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={!hayResultados || exportando}
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

        {cargando && <p className="text-sm text-muted-foreground">Cargando…</p>}

        {consultado &&
          (hayResultados ? (
            <TablaKilometraje reporte={consultado.reporte} />
          ) : (
            <p className="text-sm text-muted-foreground">No hay jornadas cerradas en ese rango.</p>
          ))}
      </CardContent>
    </Card>
  );
}
