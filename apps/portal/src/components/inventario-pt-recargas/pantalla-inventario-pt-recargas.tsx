"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { Aviso } from "@/components/ui/aviso";
import { Button } from "@/components/ui/button";
import { EncabezadoPantalla, Pantalla } from "@/components/ui/encabezado-pantalla";
import { EstadoPantalla } from "@/components/ui/estado-pantalla";
import { SelectorSegmentado } from "@/components/ui/selector-segmentado";
import { mensajeDe } from "@/lib/api";
import { diaEscrito } from "@/lib/formato";
import type { VistaPt } from "@/lib/inventario-pt";
import {
  leerInventarioPtRecargas,
  textoSinInicialRecargas,
  type InventarioPtRecargas,
  type RenglonPtRecargas,
} from "@/lib/inventario-pt-recargas";
import { TablaInventarioPtRecargas, TITULO } from "./tabla-inventario-pt-recargas";
import { VentanaAQuien } from "./ventana-a-quien";

const DESCRIPCION = "Una fotografía de lo que hay hoy en el almacén, después de las recargas a vendedores y los envíos a otra sucursal.";

/**
 * Producción › Inventario de PT con Recargas (spec 2026-11-25-inventario-pt-recargas, con los
 * cambios del tío del 2026-11-25). Solo hoy (lo dice el servidor; no hay campo de fecha), la
 * sucursal del menú lateral (con "Todas", la general) y la vista por presentación o por producto.
 * Es una fotografía a grandes rasgos: aquí no se ajusta (el ajuste se hace sobre el inventario
 * real, PT con Ventas). La página la monta con `key={sucursal}`.
 */
export function PantallaInventarioPtRecargas({ sucursal }: { sucursal: string | null }) {
  const { usuario, puede, cargando } = useAuth();

  if (cargando) return <EstadoPantalla titulo={TITULO} tipo="cargando" />;
  if (!puede("inventario_pt_recargas.ver")) return <EstadoPantalla titulo={TITULO} tipo="sin-permiso" />;

  const codigo =
    usuario?.sucursal?.codigo ??
    (sucursal && sucursal.toLowerCase() !== "todas" ? sucursal.toUpperCase() : "todas");
  return <Inventario sucursal={codigo} />;
}

function Inventario({ sucursal }: { sucursal: string }) {
  const [vista, setVista] = useState<VistaPt>("presentacion");
  const [datos, setDatos] = useState<InventarioPtRecargas | null>(null);
  const [cargandoDatos, setCargandoDatos] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detalle, setDetalle] = useState<RenglonPtRecargas | null>(null);
  const [version, setVersion] = useState(0);
  const ultima = useRef(0);
  const todas = sucursal === "todas";

  useEffect(() => {
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
  }, [sucursal, vista, version]);

  const sinInicial = datos?.renglones.filter((r) => r.inicial === null).length ?? 0;
  const deVista = datos && datos.renglones.every((r) => (vista === "producto") === (r.presentacionId === null));

  return (
    <Pantalla key="hoy">
      <EncabezadoPantalla titulo={TITULO} descripcion={DESCRIPCION} />

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
        <Aviso tono="advertencia">{textoSinInicialRecargas(sinInicial, vista, todas)}</Aviso>
      )}
      {cargandoDatos && !deVista && !error && <EstadoPantalla tipo="cargando" />}
      {datos && deVista && (
        <div className={cargandoDatos ? "flex flex-col gap-2 opacity-60" : "flex flex-col gap-2"}>
          <TablaInventarioPtRecargas renglones={datos.renglones} vista={vista} onDetalle={setDetalle} />
          <p className="text-sm text-muted-foreground">
            Pica las Recargas para ver a quién · solo restan las que el vendedor ya aceptó · es una fotografía a
            grandes rasgos: el inventario real es el de PT con Ventas.
          </p>
        </div>
      )}

      {detalle && datos && (
        <VentanaAQuien renglon={detalle} fecha={datos.fecha} sucursal={sucursal} alCerrar={() => setDetalle(null)} />
      )}
    </Pantalla>
  );
}
