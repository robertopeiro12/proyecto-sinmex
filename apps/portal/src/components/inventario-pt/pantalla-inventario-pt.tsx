"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { Aviso } from "@/components/ui/aviso";
import { Button } from "@/components/ui/button";
import { Entrada } from "@/components/ui/campo";
import { EncabezadoPantalla, Pantalla } from "@/components/ui/encabezado-pantalla";
import { EstadoPantalla } from "@/components/ui/estado-pantalla";
import { SelectorSegmentado } from "@/components/ui/selector-segmentado";
import { mensajeDe } from "@/lib/api";
import { diaAnterior } from "@/lib/fechas";
import { diaEscrito } from "@/lib/formato";
import { leerInventarioPt, textoSinInicial, type InventarioPt, type RenglonPt, type VistaPt } from "@/lib/inventario-pt";
import { hoyEnTijuana } from "@/lib/ventas";
import { AjustesInventarioPt } from "./ajustes-inventario-pt";
import { TablaInventarioPt, TITULO } from "./tabla-inventario-pt";
import { VentanaDescuentos, VentanaHistorial } from "./ventanas-detalle";

const DESCRIPCION = "El inventario real del almacén por día: lo que quedó después de ventas, merma, consumo y entradas.";

/**
 * Producción › Inventario de PT con Ventas (spec 2026-11-25, D1–D5). Un día (abre en ayer de
 * Tijuana), la sucursal del menú lateral (con "Todas", la general) y la vista por
 * presentación o por producto. "Ajustar inventario" abre la rejilla de ajustes en pantalla
 * completa. La página la monta con `key={sucursal}`.
 */
export function PantallaInventarioPt({ sucursal }: { sucursal: string | null }) {
  const { usuario, puede, cargando } = useAuth();

  if (cargando) return <EstadoPantalla titulo={TITULO} tipo="cargando" />;
  if (!puede("inventario_pt.ver")) return <EstadoPantalla titulo={TITULO} tipo="sin-permiso" />;

  const codigo =
    usuario?.sucursal?.codigo ??
    (sucursal && sucursal.toLowerCase() !== "todas" ? sucursal.toUpperCase() : "todas");
  return <Inventario sucursal={codigo} puedeAjustar={puede("inventario_pt.ajustar")} />;
}

type Detalle = { tipo: "historial" | "descuentos"; renglon: RenglonPt } | null;

function Inventario({ sucursal, puedeAjustar }: { sucursal: string; puedeAjustar: boolean }) {
  const hoy = hoyEnTijuana();
  const [fecha, setFecha] = useState(() => diaAnterior(hoy));
  const [vista, setVista] = useState<VistaPt>("presentacion");
  const [datos, setDatos] = useState<InventarioPt | null>(null);
  const [cargandoDatos, setCargandoDatos] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detalle, setDetalle] = useState<Detalle>(null);
  const [ajustando, setAjustando] = useState(false);
  const [version, setVersion] = useState(0);
  const ultima = useRef(0);
  const todas = sucursal === "todas";

  useEffect(() => {
    if (ajustando) return;
    const esta = ++ultima.current;
    setCargandoDatos(true);
    leerInventarioPt(fecha, sucursal, vista)
      .then((r) => {
        if (esta !== ultima.current) return;
        // La vista se pinta con los datos de SU consulta: al cambiar, no se mezclan.
        setDatos(r);
        setError(null);
      })
      .catch((err: unknown) => {
        if (esta !== ultima.current) return;
        setDatos(null);
        setError(mensajeDe(err, "No se pudo cargar el inventario."));
      })
      .finally(() => {
        if (esta === ultima.current) setCargandoDatos(false);
      });
  }, [fecha, sucursal, vista, version, ajustando]);

  function cambiarFecha(nueva: string) {
    // El `max` del campo no impide teclear un día futuro: ni se pide ni se cambia.
    if (nueva === "" || nueva > hoy) return;
    setFecha(nueva);
  }

  if (ajustando)
    return (
      <AjustesInventarioPt
        sucursal={sucursal}
        fechaInicial={fecha}
        hoy={hoy}
        onVolver={() => setAjustando(false)}
        onGuardado={(dia) => {
          setFecha(dia);
          setVersion((v) => v + 1);
          setAjustando(false);
        }}
      />
    );

  const sinInicial = datos?.renglones.filter((r) => r.inicial === null).length ?? 0;
  const deVista = datos && datos.renglones.every((r) => (vista === "producto") === (r.presentacionId === null));

  return (
    <Pantalla key="dia">
      <EncabezadoPantalla
        titulo={TITULO}
        descripcion={DESCRIPCION}
        acciones={
          puedeAjustar && (
            <Button
              type="button"
              variant="outline"
              disabled={todas}
              title={todas ? "Elige una sucursal en el menú lateral para ajustar su inventario." : undefined}
              onClick={() => setAjustando(true)}
            >
              Ajustar inventario
            </Button>
          )
        }
      />

      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        {/* El día como Procesos: campo + atajos Hoy · Ayer + el día escrito. */}
        <div className="flex items-center gap-2">
          <label htmlFor="pt-dia" className="text-sm text-muted-foreground">
            Día
          </label>
          <Entrada
            id="pt-dia"
            type="date"
            required
            max={hoy}
            value={fecha}
            onChange={(e) => cambiarFecha(e.target.value)}
            className="w-40"
          />
          <div role="group" aria-label="Atajos de día" className="flex items-center gap-0.5">
            <Button type="button" variant="ghost" size="sm" onClick={() => cambiarFecha(hoy)}>
              Hoy
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => cambiarFecha(diaAnterior(hoy))}>
              Ayer
            </Button>
          </div>
          <span className="text-sm text-muted-foreground">{diaEscrito(fecha, hoy)}</span>
        </div>
        <SelectorSegmentado
          etiqueta="Ver el inventario"
          resaltado
          valor={vista}
          onCambio={setVista}
          opciones={[
            { valor: "presentacion", texto: "Por presentación" },
            { valor: "producto", texto: "Por producto" },
          ]}
        />
      </div>

      {error && <Aviso tono="error">{error}</Aviso>}
      {sinInicial > 0 && deVista && (
        <Aviso tono="advertencia">
          {textoSinInicial({
            cuantos: sinInicial,
            vista,
            todas,
            puedeAjustar,
            vacias: "su Inicial, Final y Merma acumulada quedan vacíos",
            movimientos: "Los movimientos del día sí se ven.",
          })}
        </Aviso>
      )}
      {/* Sin datos de esta vista todavía (al abrir o al cambiar de vista): "Cargando…", nunca vacío. */}
      {cargandoDatos && !deVista && !error && <EstadoPantalla tipo="cargando" />}
      {datos && deVista && (
        <div className={cargandoDatos ? "flex flex-col gap-2 opacity-60" : "flex flex-col gap-2"}>
          <TablaInventarioPt
            renglones={datos.renglones}
            vista={vista}
            onProducto={(r) => setDetalle({ tipo: "historial", renglon: r })}
            onDescuentos={(r) => setDetalle({ tipo: "descuentos", renglon: r })}
          />
          <p className="text-sm text-muted-foreground">
            Pica un producto para ver sus días anteriores · pica los Descuentos para ver a quién.
          </p>
        </div>
      )}

      {detalle?.tipo === "historial" && (
        <VentanaHistorial
          renglon={detalle.renglon}
          fecha={datos?.fecha ?? fecha}
          hoy={datos?.hoyEnTijuana ?? hoy}
          sucursal={sucursal}
          alCerrar={() => setDetalle(null)}
        />
      )}
      {detalle?.tipo === "descuentos" && (
        <VentanaDescuentos
          renglon={detalle.renglon}
          fecha={datos?.fecha ?? fecha}
          sucursal={sucursal}
          alCerrar={() => setDetalle(null)}
        />
      )}
    </Pantalla>
  );
}
