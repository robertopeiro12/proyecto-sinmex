"use client";

import { useRef, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { Aviso } from "@/components/ui/aviso";
import { BotonExcel } from "@/components/ui/boton-excel";
import { EncabezadoPantalla, Pantalla } from "@/components/ui/encabezado-pantalla";
import { EstadoPantalla } from "@/components/ui/estado-pantalla";
import { FiltroFechas } from "@/components/ui/filtro-fechas";
import { mensajeDe } from "@/lib/api";
import { exportarExcel } from "@/lib/excel/exportar";
import {
  definicionExcelClientesNuevos,
  obtenerReporteClientesNuevos,
  textoTotalClientes,
  type ReporteClientesNuevos,
} from "@/lib/reporte-clientes-nuevos";
import { primerDiaDelMes, type RangoFechas } from "@/lib/fechas";
import { etiquetaSucursal, formatearFecha } from "@/lib/reportes";
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
  const [rango, setRango] = useState<RangoFechas>(() => {
    const hoy = hoyEnTijuana();
    return { desde: primerDiaDelMes(hoy), hasta: hoy };
  });
  const [consultado, setConsultado] = useState<Consultado | null>(null);
  const [cargando, setCargando] = useState(false);
  const [exportando, setExportando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Solo la última consulta escribe.
  const ultima = useRef(0);

  if (cargandoSesion) return <EstadoPantalla titulo="Clientes nuevos" tipo="cargando" />;
  if (!puede("reportes.ver")) return <EstadoPantalla titulo="Clientes nuevos" tipo="sin-permiso" />;

  // FiltroFechas ya revisó que la fecha inicial no sea posterior a la final.
  async function alMostrar({ desde, hasta }: RangoFechas) {
    setError(null);
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

  const reporte = consultado?.reporte ?? null;
  const hayClientes = reporte !== null && reporte.clientes.length > 0;
  const actualizando = cargando && consultado !== null;

  return (
    <Pantalla>
      <EncabezadoPantalla
        titulo="Clientes nuevos"
        descripcion="Los clientes dados de alta en un rango y quién los dio de alta."
      />

      {/* Mostrar siempre activo: la guarda `ultima` descarta lo viejo. */}
      <FiltroFechas
        id="cn"
        desde={rango.desde}
        hasta={rango.hasta}
        onCambio={setRango}
        onMostrar={(r) => void alMostrar(r)}
        acciones={
          <BotonExcel exportando={exportando} disabled={!hayClientes || cargando} onClick={() => void alExportar()} />
        }
      />

      {error && <Aviso tono="error">{error}</Aviso>}

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
    </Pantalla>
  );
}
