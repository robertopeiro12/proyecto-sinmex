"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { Aviso } from "@/components/ui/aviso";
import { BotonExcel } from "@/components/ui/boton-excel";
import { Campo, Lista } from "@/components/ui/campo";
import { EncabezadoPantalla, Pantalla } from "@/components/ui/encabezado-pantalla";
import { EstadoPantalla } from "@/components/ui/estado-pantalla";
import { FiltroFechas } from "@/components/ui/filtro-fechas";
import { mensajeDe } from "@/lib/api";
import { exportarExcel } from "@/lib/excel/exportar";
import { primerDiaDelMes, type RangoFechas } from "@/lib/fechas";
import {
  definicionExcelKilometraje,
  etiquetaSucursal,
  etiquetaVehiculo,
  obtenerReporteKilometraje,
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
 * con `key={sucursal}`: cambiar la sucursal en el menú empieza limpio.
 */
export function PantallaKilometraje({ sucursal }: { sucursal: string | null }) {
  const { puede, usuario, cargando: cargandoSesion } = useAuth();
  const permitido = puede("reportes.ver");
  const [rango, setRango] = useState<RangoFechas>(() => {
    const hoy = hoyEnTijuana();
    return { desde: primerDiaDelMes(hoy), hasta: hoy };
  });
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

  // Mientras /auth/me no contesta, `puede()` da false a todos: sin esto, quien
  // si tiene el permiso ve "No tienes permiso" un instante (como PantallaPerfiles).
  if (cargandoSesion) return <EstadoPantalla titulo="Reporte de Kilometraje" tipo="cargando" />;
  if (!permitido) return <EstadoPantalla titulo="Reporte de Kilometraje" tipo="sin-permiso" />;

  // FiltroFechas ya revisó que la fecha inicial no sea posterior a la final.
  async function alMostrar({ desde, hasta }: RangoFechas) {
    setError(null);
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
    <Pantalla>
      <EncabezadoPantalla
        titulo="Reporte de Kilometraje"
        descripcion="Los kilómetros de cada vehículo por jornada cerrada. Un salto avisa que la jornada empezó con otro kilometraje que el de la anterior."
      />

      <FiltroFechas
        id="km"
        desde={rango.desde}
        hasta={rango.hasta}
        onCambio={setRango}
        onMostrar={(r) => void alMostrar(r)}
        deshabilitado={cargando}
        acciones={<BotonExcel exportando={exportando} disabled={!hayResultados} onClick={() => void alExportar()} />}
      >
        <Campo id="km-vehiculo" etiqueta="Vehículo">
          <Lista value={vehiculoId} onChange={(e) => setVehiculoId(e.target.value)}>
            <option value="">Todos</option>
            {vehiculos.map((v) => (
              <option key={v.id} value={v.id}>
                {etiquetaVehiculo(v)}
              </option>
            ))}
          </Lista>
        </Campo>
      </FiltroFechas>

      {error && <Aviso tono="error">{error}</Aviso>}

      {cargando && <p className="text-sm text-muted-foreground">Cargando…</p>}

      {consultado &&
        (hayResultados ? (
          <TablaKilometraje reporte={consultado.reporte} />
        ) : (
          <p className="text-sm text-muted-foreground">No hay jornadas cerradas en ese rango.</p>
        ))}
    </Pantalla>
  );
}
