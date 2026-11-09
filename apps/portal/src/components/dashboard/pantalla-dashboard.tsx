"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { ResumenCifras } from "@/components/flujo-diario/resumen-cifras";
import { Aviso } from "@/components/ui/aviso";
import { EncabezadoPantalla, Pantalla } from "@/components/ui/encabezado-pantalla";
import { EstadoPantalla } from "@/components/ui/estado-pantalla";
import { mensajeDe } from "@/lib/api";
import { obtenerDashboard, type Dashboard, type Totales } from "@/lib/flujo-diario";
import { formatearDiaLargo } from "@/lib/formato";
import { listarSucursales, type Sucursal } from "@/lib/sucursales";
import { TablaDashboard } from "./tabla-dashboard";

const TITULO = "Dashboard";
/** Cada cuánto se vuelve a consultar sola mientras la pestaña del navegador se ve. */
const CADA_MS = 60_000;

/** "hace un momento" (menos de un minuto) o "hace N min". */
function haceCuanto(desdeMs: number, ahoraMs: number): string {
  const minutos = Math.floor((ahoraMs - desdeMs) / 60_000);
  return minutos < 1 ? "hace un momento" : `hace ${minutos} min`;
}

/** "4 en ruta · 1 terminó". */
function textoVendedores(enRuta: number, terminaron: number): string {
  return `${enRuta} en ruta · ${terminaron} ${terminaron === 1 ? "terminó" : "terminaron"}`;
}

/**
 * Operación → Dashboard (spec §5.2): lo que llevan HOY (de Tijuana, la fecha la da el
 * servidor) los vendedores en ruta. Se actualiza sola cada 60 s mientras la pestaña se ve, y
 * al volver a ella; la actualización no cierra el renglón abierto ni cambia su pestaña. La
 * página la monta con `key={sucursal}`: cambiar la sucursal empieza limpio.
 */
export function PantallaDashboard({ sucursal }: { sucursal: string | null }) {
  const { puede, cargando: cargandoSesion } = useAuth();
  const permitido = puede("dashboard.ver");
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  // `numero` cambia en cada consulta que llega: la tabla vuelve a pedir el detalle abierto.
  const [consultado, setConsultado] = useState<{ dashboard: Dashboard; enMs: number; numero: number } | null>(null);
  const [ahoraMs, setAhoraMs] = useState(() => Date.now());
  const [error, setError] = useState<string | null>(null);
  // Solo la última consulta escribe: una lenta que llega tarde no pisa a la nueva.
  const ultima = useRef(0);

  useEffect(() => {
    if (!permitido) return;
    let vigente = true;
    listarSucursales().then(
      (lista) => {
        if (vigente) setSucursales(lista);
      },
      () => {
        // Sin nombres, los bloques dicen el código (TJ, MX).
      },
    );
    return () => {
      vigente = false;
    };
  }, [permitido]);

  useEffect(() => {
    if (!permitido) return;
    let vigente = true;

    async function consultar() {
      const esta = ++ultima.current;
      try {
        const dashboard = await obtenerDashboard(sucursal);
        if (!vigente || esta !== ultima.current) return;
        const enMs = Date.now();
        setConsultado((antes) => ({ dashboard, enMs, numero: (antes?.numero ?? 0) + 1 }));
        setAhoraMs(enMs);
        setError(null);
      } catch (err) {
        if (!vigente || esta !== ultima.current) return;
        // Lo que ya se veía se queda; el aviso dice que no se pudo actualizar.
        setError(mensajeDe(err, "No se pudo consultar el Dashboard."));
      }
    }

    const visible = () => document.visibilityState === "visible";
    void consultar();
    const reloj = setInterval(() => {
      setAhoraMs(Date.now());
      if (visible()) void consultar();
    }, CADA_MS);
    const alCambiarVisibilidad = () => {
      if (!visible()) return;
      setAhoraMs(Date.now());
      void consultar();
    };
    document.addEventListener("visibilitychange", alCambiarVisibilidad);
    return () => {
      vigente = false;
      clearInterval(reloj);
      document.removeEventListener("visibilitychange", alCambiarVisibilidad);
    };
  }, [permitido, sucursal]);

  if (cargandoSesion) return <EstadoPantalla titulo={TITULO} tipo="cargando" />;
  if (!permitido) return <EstadoPantalla titulo={TITULO} tipo="sin-permiso" />;

  const nombreSucursal = (codigo: string) => sucursales.find((s) => s.codigo === codigo)?.nombre ?? codigo;
  const dashboard = consultado?.dashboard ?? null;
  const varias = (dashboard?.bloques.length ?? 0) > 1;

  return (
    <Pantalla>
      <EncabezadoPantalla
        titulo={TITULO}
        descripcion="Lo que llevan hoy los vendedores en ruta. Pica un vendedor o un número para ver el detalle."
        acciones={
          consultado && (
            <p className="flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
              <span aria-hidden className="inline-block size-2 rounded-full bg-success" />
              {`Hoy, ${formatearDiaLargo(consultado.dashboard.fecha)} · se actualiza solo · ${haceCuanto(consultado.enMs, ahoraMs)}`}
            </p>
          )
        }
      />

      {error && <Aviso tono="error">{error}</Aviso>}

      {!consultado && !error && <p className="text-sm text-muted-foreground">Cargando…</p>}

      {dashboard &&
        (dashboard.vendedores.length === 0 ? (
          <Aviso tono="informacion">No hay vendedores en ruta hoy.</Aviso>
        ) : (
          <>
            {varias ? (
              <div className="flex flex-col gap-4">
                {dashboard.bloques.map((b) => {
                  const nombre = nombreSucursal(b.sucursalCodigo);
                  return (
                    <Resumen
                      key={b.sucursalCodigo}
                      titulo={nombre}
                      etiqueta={`Resumen de ${nombre}`}
                      totales={b.totales}
                      enRuta={b.enRuta}
                      terminaron={b.terminaron}
                    />
                  );
                })}
                <Resumen
                  titulo="Total"
                  etiqueta="Resumen total"
                  totales={dashboard.total}
                  enRuta={dashboard.total.enRuta}
                  terminaron={dashboard.total.terminaron}
                />
              </div>
            ) : (
              <Resumen totales={dashboard.total} enRuta={dashboard.total.enRuta} terminaron={dashboard.total.terminaron} />
            )}
            <TablaDashboard dashboard={dashboard} actualizacion={consultado!.numero} nombreSucursal={nombreSucursal} />
          </>
        ))}
    </Pantalla>
  );
}

/** La fila de cifras; con varias sucursales lleva su título (Tijuana, Mexicali, Total). */
function Resumen({
  titulo,
  etiqueta,
  totales,
  enRuta,
  terminaron,
}: {
  titulo?: string;
  etiqueta?: string;
  totales: Totales;
  enRuta: number;
  terminaron: number;
}) {
  const cifras = (
    <ResumenCifras
      totales={totales}
      ultima={{
        titulo: "Vendedores",
        valor: String(enRuta + terminaron),
        detalle: textoVendedores(enRuta, terminaron),
      }}
    />
  );
  if (!titulo) return cifras;
  return (
    <section aria-label={etiqueta} className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold">{titulo}</h2>
      {cifras}
    </section>
  );
}
