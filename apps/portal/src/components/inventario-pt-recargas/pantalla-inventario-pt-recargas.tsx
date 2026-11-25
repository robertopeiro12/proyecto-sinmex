"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { AjustesInventarioPt } from "@/components/inventario-pt/ajustes-inventario-pt";
import { Aviso } from "@/components/ui/aviso";
import { Button } from "@/components/ui/button";
import { EncabezadoPantalla, Pantalla } from "@/components/ui/encabezado-pantalla";
import { EstadoPantalla } from "@/components/ui/estado-pantalla";
import { SelectorSegmentado } from "@/components/ui/selector-segmentado";
import { mensajeDe } from "@/lib/api";
import { diaEscrito } from "@/lib/formato";
import { textoSinInicial, type VistaPt } from "@/lib/inventario-pt";
import {
  leerInventarioPtRecargas,
  type ColumnaDetalleRecargas,
  type InventarioPtRecargas,
  type RenglonPtRecargas,
} from "@/lib/inventario-pt-recargas";
import { TablaInventarioPtRecargas, TITULO } from "./tabla-inventario-pt-recargas";
import { VentanaAQuien } from "./ventana-a-quien";

const DESCRIPCION = "Lo que hay hoy en el almacén, después de las recargas a vendedores y los envíos a otra sucursal.";

/**
 * Producción › Inventario de PT con Recargas (spec 2026-11-25-inventario-pt-recargas, D1–D6).
 * Solo hoy (lo dice el servidor; no hay campo de fecha), la sucursal del menú lateral (con
 * "Todas", la general) y la vista por presentación o por producto. "Ajustar inventario" abre
 * la misma rejilla de ajustes de PT con Ventas, fija en hoy. La página la monta con `key={sucursal}`.
 */
export function PantallaInventarioPtRecargas({ sucursal }: { sucursal: string | null }) {
  const { usuario, puede, cargando } = useAuth();

  if (cargando) return <EstadoPantalla titulo={TITULO} tipo="cargando" />;
  if (!puede("inventario_pt_recargas.ver")) return <EstadoPantalla titulo={TITULO} tipo="sin-permiso" />;

  const codigo =
    usuario?.sucursal?.codigo ??
    (sucursal && sucursal.toLowerCase() !== "todas" ? sucursal.toUpperCase() : "todas");
  return <Inventario sucursal={codigo} puedeAjustar={puede("inventario_pt.ajustar")} />;
}

type Detalle = { renglon: RenglonPtRecargas; columna: ColumnaDetalleRecargas } | null;

function Inventario({ sucursal, puedeAjustar }: { sucursal: string; puedeAjustar: boolean }) {
  const [vista, setVista] = useState<VistaPt>("presentacion");
  const [datos, setDatos] = useState<InventarioPtRecargas | null>(null);
  const [cargandoDatos, setCargandoDatos] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detalle, setDetalle] = useState<Detalle>(null);
  const [ajustando, setAjustando] = useState(false);
  const [version, setVersion] = useState(0);
  const ultima = useRef(0);
  const todas = sucursal === "todas";

  useEffect(() => {
    // Al volver de ajustar (`ajustando` pasa a false) también se vuelve a pedir.
    if (ajustando) return;
    const esta = ++ultima.current;
    setCargandoDatos(true);
    leerInventarioPtRecargas(sucursal, vista)
      .then((r) => {
        if (esta !== ultima.current) return;
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
  }, [sucursal, vista, version, ajustando]);

  if (ajustando && datos)
    return (
      <AjustesInventarioPt
        sucursal={sucursal}
        fechaInicial={datos.hoyEnTijuana}
        hoy={datos.hoyEnTijuana}
        fijaEnHoy
        volverA={TITULO}
        onVolver={() => setAjustando(false)}
        onGuardado={() => setAjustando(false)}
      />
    );

  const sinInicial = datos?.renglones.filter((r) => r.inicial === null).length ?? 0;
  const deVista = datos && datos.renglones.every((r) => (vista === "producto") === (r.presentacionId === null));

  return (
    <Pantalla key="hoy">
      <EncabezadoPantalla
        titulo={TITULO}
        descripcion={DESCRIPCION}
        acciones={
          puedeAjustar && (
            <Button
              type="button"
              variant="outline"
              // "Hoy" sale de la consulta: sin datos todavía no se sabe qué día ajustar.
              disabled={todas || !datos}
              title={todas ? "Elige una sucursal en el menú lateral para ajustar su inventario." : undefined}
              onClick={() => setAjustando(true)}
            >
              Ajustar inventario
            </Button>
          )
        }
      />

      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <div className="flex items-center gap-2">
          {datos && (
            <span className="text-sm text-muted-foreground">
              {`${diaEscrito(datos.fecha, datos.hoyEnTijuana)} · a las ${datos.consultadoEn}`}
            </span>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={cargandoDatos}
            onClick={() => setVersion((v) => v + 1)}
          >
            Actualizar
          </Button>
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
            vacias: "su Inicial y Actual quedan vacíos",
            movimientos: "Los movimientos de hoy sí se ven.",
          })}
        </Aviso>
      )}
      {cargandoDatos && !deVista && !error && <EstadoPantalla tipo="cargando" />}
      {datos && deVista && (
        <div className={cargandoDatos ? "flex flex-col gap-2 opacity-60" : "flex flex-col gap-2"}>
          <TablaInventarioPtRecargas
            renglones={datos.renglones}
            vista={vista}
            onDetalle={(renglon, columna) => setDetalle({ renglon, columna })}
          />
          <p className="text-sm text-muted-foreground">
            Pica las Recargas o los Descuentos para ver a quién · no cuenta lo que regresan los vendedores (eso es PT con Ventas).
          </p>
        </div>
      )}

      {detalle && datos && (
        <VentanaAQuien
          renglon={detalle.renglon}
          columna={detalle.columna}
          fecha={datos.fecha}
          sucursal={sucursal}
          alCerrar={() => setDetalle(null)}
        />
      )}
    </Pantalla>
  );
}
