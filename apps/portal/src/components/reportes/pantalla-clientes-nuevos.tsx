"use client";

import { useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/components/auth/auth-provider";
import { mensajeDe } from "@/lib/api";
import { exportarExcel } from "@/lib/excel/exportar";
import {
  definicionExcelClientesNuevos,
  obtenerReporteClientesNuevos,
  textoTotalClientes,
  type ReporteClientesNuevos,
} from "@/lib/reporte-clientes-nuevos";
import { rangoMes, rangoSemana } from "@/lib/reporte-ventas";
import { etiquetaSucursal, formatearFecha, primerDiaDelMes } from "@/lib/reportes";
import { hoyEnTijuana } from "@/lib/ventas";
import { TablaClientesNuevos } from "./tabla-clientes-nuevos";

interface Consultado {
  reporte: ReporteClientesNuevos;
  sucursal: string;
}

/**
 * Información → Reportes → Clientes nuevos (T-51). La página la monta con
 * `key={sucursal}`: cambiar la sucursal empieza limpio.
 */
export function PantallaClientesNuevos({ sucursal }: { sucursal: string | null }) {
  const { puede, usuario, cargando: cargandoSesion } = useAuth();
  const [desde, setDesde] = useState(() => primerDiaDelMes(hoyEnTijuana()));
  const [hasta, setHasta] = useState(() => hoyEnTijuana());
  const [consultado, setConsultado] = useState<Consultado | null>(null);
  const [cargando, setCargando] = useState(false);
  const [exportando, setExportando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Solo la última consulta escribe.
  const ultima = useRef(0);

  const titulo = (
    <CardHeader>
      <CardTitle>Clientes nuevos</CardTitle>
    </CardHeader>
  );

  if (cargandoSesion) {
    return (
      <Card>
        {titulo}
        <CardContent>
          <p className="text-sm text-muted-foreground">Cargando…</p>
        </CardContent>
      </Card>
    );
  }

  if (!puede("reportes.ver")) {
    return (
      <Card>
        {titulo}
        <CardContent>
          <p className="text-sm text-muted-foreground">No tienes permiso para ver reportes</p>
        </CardContent>
      </Card>
    );
  }

  function aplicar(r: { desde: string; hasta: string }) {
    setDesde(r.desde);
    setHasta(r.hasta);
  }

  async function alMostrar(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (desde > hasta) {
      setError("La fecha inicial no puede ser posterior a la final.");
      return;
    }
    const esta = ++ultima.current;
    setCargando(true);
    try {
      const reporte = await obtenerReporteClientesNuevos({ desde, hasta, sucursal });
      if (esta !== ultima.current) return;
      setConsultado({ reporte, sucursal: etiquetaSucursal(usuario?.sucursal?.codigo ?? null, sucursal) });
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
      await exportarExcel(definicionExcelClientesNuevos(consultado.reporte, { sucursal: consultado.sucursal }));
    } catch {
      setError("No se pudo generar el Excel.");
    } finally {
      setExportando(false);
    }
  }

  const hoy = hoyEnTijuana();
  const reporte = consultado?.reporte ?? null;
  const hayClientes = reporte !== null && reporte.clientes.length > 0;
  const actualizando = cargando && consultado !== null;

  return (
    <Card>
      {titulo}
      <CardContent className="flex flex-col gap-5">
        <form onSubmit={alMostrar} className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="cn-desde" className="text-sm font-medium">Desde</label>
            <input id="cn-desde" type="date" required value={desde} onChange={(e) => setDesde(e.target.value)} className="rounded-md border px-3 py-2 text-sm" />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="cn-hasta" className="text-sm font-medium">Hasta</label>
            <input id="cn-hasta" type="date" required value={hasta} onChange={(e) => setHasta(e.target.value)} className="rounded-md border px-3 py-2 text-sm" />
          </div>
          <div className="flex items-end gap-1">
            <Button type="button" variant="ghost" size="sm" onClick={() => aplicar({ desde: hoy, hasta: hoy })}>Hoy</Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => aplicar(rangoSemana(hoy))}>Esta semana</Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => aplicar(rangoMes(hoy))}>Este mes</Button>
          </div>
          {/* Siempre activo: la guarda `ultima` descarta lo viejo. */}
          <Button type="submit">Mostrar</Button>
          <Button type="button" variant="outline" disabled={!hayClientes || exportando || cargando} onClick={() => void alExportar()}>
            Exportar a Excel
          </Button>
        </form>

        {error && (
          <p role="alert" className="text-sm text-destructive">{error}</p>
        )}

        {cargando && !consultado && <p className="text-sm text-muted-foreground">Cargando…</p>}
        {actualizando && <p className="text-sm text-muted-foreground">Actualizando…</p>}

        {consultado && reporte &&
          (hayClientes ? (
            <div aria-busy={actualizando} className={`flex flex-col gap-3 ${actualizando ? "opacity-60" : ""}`}>
              <p className="text-sm text-muted-foreground">
                {`Del ${formatearFecha(reporte.desde)} al ${formatearFecha(reporte.hasta)} · Sucursal: ${consultado.sucursal}`}
              </p>
              <p className="text-sm font-medium">{textoTotalClientes(reporte.total)}</p>
              <TablaClientesNuevos clientes={reporte.clientes} />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No hay clientes nuevos en ese rango.</p>
          ))}
      </CardContent>
    </Card>
  );
}
