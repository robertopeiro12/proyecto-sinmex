"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { Aviso } from "@/components/ui/aviso";
import { EncabezadoPantalla, Pantalla } from "@/components/ui/encabezado-pantalla";
import { EstadoPantalla } from "@/components/ui/estado-pantalla";
import { FiltroFechas } from "@/components/ui/filtro-fechas";
import { SelectorSegmentado } from "@/components/ui/selector-segmentado";
import { mensajeDe } from "@/lib/api";
import { primerDiaDelMes, type RangoFechas } from "@/lib/fechas";
import {
  leerInformacionProduccion,
  type InformacionProduccion,
  type RenglonInformacion,
} from "@/lib/informacion-produccion";
import type { VistaPt } from "@/lib/inventario-pt";
import { hoyEnTijuana } from "@/lib/ventas";
import { TablaInformacionProduccion, TITULO } from "./tabla-informacion-produccion";
import { VentanaDetalleInformacion } from "./ventana-detalle-informacion";

const DESCRIPCION =
  "Lo que se produjo y se compró en un rango de días, según las Entradas/Compras del Registro de Operación.";

/**
 * Producción › Información de Producción (spec 2026-11-28-informacion-de-produccion). Solo
 * lectura y sin Excel (va en Reportes). La página la monta con `key={sucursal}`.
 */
export function PantallaInformacionProduccion({ sucursal }: { sucursal: string | null }) {
  const { usuario, puede, cargando } = useAuth();

  if (cargando) return <EstadoPantalla titulo={TITULO} tipo="cargando" />;
  if (!puede("informacion_produccion.ver")) return <EstadoPantalla titulo={TITULO} tipo="sin-permiso" />;

  const codigo =
    usuario?.sucursal?.codigo ??
    (sucursal && sucursal.toLowerCase() !== "todas" ? sucursal.toUpperCase() : "todas");
  return <Informacion sucursal={codigo} />;
}

function Informacion({ sucursal }: { sucursal: string }) {
  const [rango, setRango] = useState<RangoFechas>(() => {
    const hoy = hoyEnTijuana();
    return { desde: primerDiaDelMes(hoy), hasta: hoy };
  });
  // El rango ya consultado: cambiar de vista usa este, no lo escrito en los campos.
  // Cada Mostrar crea un objeto nuevo, así que repetir el mismo rango vuelve a consultar.
  const [consultado, setConsultado] = useState<RangoFechas>(rango);
  const [vista, setVista] = useState<VistaPt>("presentacion");
  const [datos, setDatos] = useState<InformacionProduccion | null>(null);
  const [cargandoDatos, setCargandoDatos] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detalle, setDetalle] = useState<RenglonInformacion | null>(null);
  const ultima = useRef(0);

  useEffect(() => {
    const esta = ++ultima.current;
    setCargandoDatos(true);
    leerInformacionProduccion(consultado.desde, consultado.hasta, sucursal, vista)
      .then((r) => {
        if (esta !== ultima.current) return;
        setDatos(r);
        setError(null);
      })
      .catch((err: unknown) => {
        if (esta !== ultima.current) return;
        setDatos(null);
        setError(mensajeDe(err, "No se pudo cargar la información."));
      })
      .finally(() => {
        if (esta === ultima.current) setCargandoDatos(false);
      });
  }, [consultado, sucursal, vista]);

  const deVista = datos && datos.renglones.every((r) => (vista === "producto") === (r.presentacionId === null));

  return (
    <Pantalla key="rango">
      <EncabezadoPantalla titulo={TITULO} descripcion={DESCRIPCION} />

      <FiltroFechas
        id="informacion-produccion"
        desde={rango.desde}
        hasta={rango.hasta}
        onCambio={setRango}
        onMostrar={(r) => setConsultado({ ...r })}
        deshabilitado={cargandoDatos}
      >
        <SelectorSegmentado
          etiqueta="Ver la información"
          resaltado
          valor={vista}
          onCambio={setVista}
          opciones={[
            { valor: "presentacion", texto: "Por presentación" },
            { valor: "producto", texto: "Por producto" },
          ]}
        />
      </FiltroFechas>

      {error && <Aviso tono="error">{error}</Aviso>}
      {cargandoDatos && !deVista && !error && <EstadoPantalla tipo="cargando" />}
      {datos && deVista && (
        <div className={cargandoDatos ? "opacity-60" : undefined}>
          <TablaInformacionProduccion renglones={datos.renglones} vista={vista} onDetalle={setDetalle} />
        </div>
      )}

      {detalle && datos && (
        <VentanaDetalleInformacion
          renglon={detalle}
          desde={datos.desde}
          hasta={datos.hasta}
          sucursal={sucursal}
          alCerrar={() => setDetalle(null)}
        />
      )}
    </Pantalla>
  );
}
