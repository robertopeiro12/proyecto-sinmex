"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { Aviso } from "@/components/ui/aviso";
import { Button } from "@/components/ui/button";
import { Campo, Entrada, Lista } from "@/components/ui/campo";
import { EncabezadoPantalla, Pantalla } from "@/components/ui/encabezado-pantalla";
import { EstadoPantalla } from "@/components/ui/estado-pantalla";
import { mensajeDe } from "@/lib/api";
import { diaAnterior } from "@/lib/fechas";
import {
  leerInventarioVendedor,
  type InventarioVendedor,
} from "@/lib/inventario-vendedor";
import { listarVendedores, type Vendedor } from "@/lib/vendedores";
import { hoyEnTijuana } from "@/lib/ventas";
import { TablasInventario } from "./tablas-inventario";

const TITULO = "Inventario por vendedor";
const DESCRIPCION = "Lo que cargó, vendió y regresó cada vendedor, por tamaño.";

/**
 * Producción › Inventario por vendedor (spec 2026-11-24). Un día, una sucursal y un
 * vendedor o todos. Atado: su sucursal; General: la del selector del menú (sin ella, pide
 * elegirla). La página la monta con `key={sucursal}`.
 */
export function PantallaInventarioVendedor({ sucursal }: { sucursal: string | null }) {
  const { usuario, puede, cargando } = useAuth();

  if (cargando) return <EstadoPantalla titulo={TITULO} tipo="cargando" />;
  if (!puede("inventario.ver")) return <EstadoPantalla titulo={TITULO} tipo="sin-permiso" />;

  const codigo =
    usuario?.sucursal?.codigo ??
    (sucursal && sucursal.toLowerCase() !== "todas" ? sucursal.toUpperCase() : null);
  if (!codigo) return <EstadoPantalla titulo={TITULO} tipo="elige-sucursal" />;
  return <Inventario sucursal={codigo} />;
}

function Inventario({ sucursal }: { sucursal: string }) {
  const hoy = hoyEnTijuana();
  const [fecha, setFecha] = useState(hoy);
  const [vendedor, setVendedor] = useState("todos");
  const [vendedores, setVendedores] = useState<Vendedor[]>([]);
  const [datos, setDatos] = useState<InventarioVendedor | null>(null);
  const [cargandoDatos, setCargandoDatos] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const ultima = useRef(0);

  useEffect(() => {
    let vigente = true;
    listarVendedores(sucursal).then(
      (lista) => {
        if (vigente) setVendedores(lista);
      },
      () => {
        // Sin lista, queda "Todos los vendedores".
      },
    );
    return () => {
      vigente = false;
    };
  }, [sucursal]);

  useEffect(() => {
    const esta = ++ultima.current;
    setCargandoDatos(true);
    leerInventarioVendedor(fecha, sucursal, vendedor)
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
  }, [fecha, sucursal, vendedor]);

  function cambiarFecha(nueva: string) {
    // El `max` del campo no impide teclear un día futuro: ni se pide ni se cambia.
    if (nueva === "" || nueva > hoy) return;
    setFecha(nueva);
  }

  return (
    <Pantalla>
      <EncabezadoPantalla titulo={TITULO} descripcion={DESCRIPCION} />

      <div className="flex flex-wrap items-end gap-3">
        <Campo id="inventario-fecha" etiqueta="Día" className="w-48">
          <Entrada type="date" required max={hoy} value={fecha} onChange={(e) => cambiarFecha(e.target.value)} />
        </Campo>
        <div role="group" aria-label="Atajos de día" className="flex items-center gap-0.5">
          <Button type="button" variant="ghost" size="sm" onClick={() => cambiarFecha(hoy)}>
            Hoy
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => cambiarFecha(diaAnterior(hoy))}>
            Ayer
          </Button>
        </div>
        <Campo id="inventario-vendedor" etiqueta="Vendedor" className="w-64">
          <Lista value={vendedor} onChange={(e) => setVendedor(e.target.value)}>
            <option value="todos">Todos los vendedores</option>
            {vendedores.map((v) => (
              <option key={v.id} value={v.id}>
                {v.activo ? v.nombre : `${v.nombre} (inactivo)`}
              </option>
            ))}
          </Lista>
        </Campo>
      </div>

      {error && <Aviso tono="error">{error}</Aviso>}
      {cargandoDatos && !datos && !error && <EstadoPantalla tipo="cargando" />}
      {datos && (
        <div className={cargandoDatos ? "opacity-60" : undefined}>
          <TablasInventario datos={datos} />
        </div>
      )}
    </Pantalla>
  );
}
