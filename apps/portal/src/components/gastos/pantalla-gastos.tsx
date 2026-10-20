"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/components/auth/auth-provider";
import { mensajeDe } from "@/lib/api";
import { listarCamposEgreso, type CampoEgreso } from "@/lib/campos-egreso";
import { obtenerGastos, PERMISO_VER_GASTOS, type ListaGastos } from "@/lib/gastos";
import { formatearFecha } from "@/lib/reportes";
import { listarVendedores, type Vendedor } from "@/lib/vendedores";
import { formatearPesos, hoyEnTijuana } from "@/lib/ventas";
import { TablaGastos } from "./tabla-gastos";

/**
 * Finanzas › Gastos (T-30/T-31, D10): los gastos que registran los vendedores en la
 * ruta, con su ticket. Consulta al abrir con hoy en Tijuana (como Tesorería); la
 * página la monta con `key={sucursal}`: cambiar el filtro global empieza limpio.
 */
export function PantallaGastos({ sucursal }: { sucursal: string | null }) {
  const { puede, usuario, cargando: cargandoSesion } = useAuth();
  const permitido = puede(PERMISO_VER_GASTOS);
  const hoy = hoyEnTijuana();
  const [desde, setDesde] = useState(hoy);
  const [hasta, setHasta] = useState(hoy);
  const [vendedor, setVendedor] = useState("");
  const [campo, setCampo] = useState("");
  const [vendedores, setVendedores] = useState<Vendedor[]>([]);
  const [campos, setCampos] = useState<CampoEgreso[]>([]);
  const [lista, setLista] = useState<ListaGastos | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Solo la última consulta escribe: una lenta que llega tarde no pisa a la nueva.
  const ultima = useRef(0);

  const consultar = useCallback(
    async (f: { desde: string; hasta: string; vendedor: string; campo: string }) => {
      setError(null);
      if (f.desde > f.hasta) {
        setError("La fecha inicial no puede ser posterior a la final.");
        return;
      }
      const esta = ++ultima.current;
      setCargando(true);
      try {
        const r = await obtenerGastos({
          desde: f.desde,
          hasta: f.hasta,
          sucursal,
          vendedor: f.vendedor || null,
          campo: f.campo || null,
        });
        if (esta === ultima.current) setLista(r);
      } catch (err) {
        if (esta !== ultima.current) return;
        setLista(null);
        setError(mensajeDe(err, "No se pudieron consultar los gastos."));
      } finally {
        if (esta === ultima.current) setCargando(false);
      }
    },
    [sucursal],
  );

  // "Por defecto, hoy en Tijuana" (D10): consulta al abrir.
  useEffect(() => {
    if (!permitido) return;
    void consultar({ desde: hoy, hasta: hoy, vendedor: "", campo: "" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permitido, consultar]);

  useEffect(() => {
    if (!permitido) return;
    let vigente = true;
    // Sin estas listas los filtros se quedan en "Todos": la consulta sigue sirviendo.
    listarVendedores(sucursal).then(
      (l) => {
        if (vigente) setVendedores(l);
      },
      () => undefined,
    );
    listarCamposEgreso().then(
      (l) => {
        if (vigente) setCampos(l);
      },
      () => undefined,
    );
    return () => {
      vigente = false;
    };
  }, [permitido, sucursal]);

  if (cargandoSesion || !permitido) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Gastos</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {cargandoSesion ? "Cargando…" : "No tienes permiso para ver los gastos"}
          </p>
        </CardContent>
      </Card>
    );
  }

  function alMostrar(e: FormEvent) {
    e.preventDefault();
    void consultar({ desde, hasta, vendedor, campo });
  }

  // Viendo todas las sucursales, dos vendedores pueden llamarse igual: se distingue con el código.
  const verTodas = !usuario?.sucursal && (sucursal === null || sucursal.toLowerCase() === "todas");
  const nombreVendedor = (v: Vendedor) => (verTodas ? `${v.nombre} · ${v.sucursalCodigo}` : v.nombre);
  const n = lista?.gastos.length ?? 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Gastos</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <form onSubmit={alMostrar} className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="gastos-desde" className="text-sm font-medium">
              Desde
            </label>
            <input
              id="gastos-desde"
              type="date"
              required
              value={desde}
              onChange={(e) => setDesde(e.target.value)}
              className="rounded-md border px-3 py-2 text-sm"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="gastos-hasta" className="text-sm font-medium">
              Hasta
            </label>
            <input
              id="gastos-hasta"
              type="date"
              required
              value={hasta}
              onChange={(e) => setHasta(e.target.value)}
              className="rounded-md border px-3 py-2 text-sm"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="gastos-vendedor" className="text-sm font-medium">
              Vendedor
            </label>
            <select
              id="gastos-vendedor"
              value={vendedor}
              onChange={(e) => setVendedor(e.target.value)}
              className="rounded-md border px-3 py-2 text-sm"
            >
              <option value="">Todos</option>
              {vendedores.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.activo ? nombreVendedor(v) : `${nombreVendedor(v)} (inactivo)`}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="gastos-campo" className="text-sm font-medium">
              Campo
            </label>
            <select
              id="gastos-campo"
              value={campo}
              onChange={(e) => setCampo(e.target.value)}
              className="rounded-md border px-3 py-2 text-sm"
            >
              <option value="">Todos</option>
              {campos.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                </option>
              ))}
            </select>
          </div>
          <Button type="submit">Mostrar</Button>
        </form>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {cargando && !lista && <p className="text-sm text-muted-foreground">Cargando…</p>}

        {lista &&
          (n > 0 ? (
            <div aria-busy={cargando} className={`flex flex-col gap-3 ${cargando ? "opacity-60" : ""}`}>
              <p className="text-sm text-muted-foreground">
                {`Del ${formatearFecha(lista.desde)} al ${formatearFecha(lista.hasta)}`}
              </p>
              <TablaGastos gastos={lista.gastos} />
              <p className="text-sm font-semibold">
                {`Total: ${formatearPesos(lista.totalCentavos)} · ${n} ${n === 1 ? "gasto" : "gastos"}`}
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No hay gastos en ese rango.</p>
          ))}
      </CardContent>
    </Card>
  );
}
