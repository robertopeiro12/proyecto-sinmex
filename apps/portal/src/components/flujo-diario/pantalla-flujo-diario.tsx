"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { Aviso } from "@/components/ui/aviso";
import { Campo, Lista } from "@/components/ui/campo";
import { EncabezadoPantalla, Pantalla } from "@/components/ui/encabezado-pantalla";
import { EstadoPantalla } from "@/components/ui/estado-pantalla";
import { FiltroFechas } from "@/components/ui/filtro-fechas";
import { Pestanas } from "@/components/ui/pestanas";
import { mensajeDe } from "@/lib/api";
import { diaAnterior, type RangoFechas } from "@/lib/fechas";
import { obtenerFlujoDiario, type FlujoDiario } from "@/lib/flujo-diario";
import { formatearPesos, plural } from "@/lib/formato";
import { listarSucursales, type Sucursal } from "@/lib/sucursales";
import { listarVendedores, type Vendedor } from "@/lib/vendedores";
import { hoyEnTijuana } from "@/lib/ventas";
import { ResumenCifras } from "./resumen-cifras";
import { TablaPorDia } from "./tabla-por-dia";
import { TablaPorVendedor } from "./tabla-por-vendedor";

const TITULO = "Flujo diario";

/**
 * Operación → Flujo diario (spec §5.3; reemplaza al Reporte de Ventas de T-49 en la misma
 * dirección): qué hizo cada vendedor en días pasados. Abre en "Ayer" de Tijuana y consulta
 * sola. La página la monta con `key={sucursal}`: cambiar la sucursal empieza limpio.
 */
export function PantallaFlujoDiario({ sucursal }: { sucursal: string | null }) {
  const { puede, usuario, cargando: cargandoSesion } = useAuth();
  const permitido = puede("reporte_ventas.ver");
  const [desde, setDesde] = useState(() => diaAnterior(hoyEnTijuana()));
  const [hasta, setHasta] = useState(() => diaAnterior(hoyEnTijuana()));
  const [vendedor, setVendedor] = useState("");
  const [vendedores, setVendedores] = useState<Vendedor[]>([]);
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  // `numero` cambia en cada consulta: las tablas se vuelven a montar y cierran su detalle
  // (la pestaña Por vendedor / Por día se conserva). "Por día" es de toda la sucursal, así
  // que con un vendedor elegido se consultan dos: `porVendedor` (filtrado) y `porDia` (todos).
  const [consultado, setConsultado] = useState<{ porVendedor: FlujoDiario; porDia: FlujoDiario; numero: number } | null>(null);
  // Las cifras de arriba siguen a la pestaña: "Por día" suma también la oficina.
  const [pestana, setPestana] = useState<"vendedor" | "dia">("vendedor");
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Solo la última consulta escribe: una lenta que llega tarde no pisa a la nueva.
  const ultima = useRef(0);

  useEffect(() => {
    if (!permitido) return;
    let vigente = true;
    listarVendedores(sucursal).then(
      (lista) => {
        if (vigente) setVendedores(lista);
      },
      () => {
        // Sin la lista, el filtro se queda en "Todos": la pantalla sigue sirviendo.
      },
    );
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
  }, [permitido, sucursal]);

  // Consulta sola al entrar, con "Ayer". La sucursal no cambia sin volver a montar (`key`).
  useEffect(() => {
    if (permitido) void alMostrar({ desde, hasta });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permitido]);

  if (cargandoSesion) return <EstadoPantalla titulo={TITULO} tipo="cargando" />;
  if (!permitido) return <EstadoPantalla titulo={TITULO} tipo="sin-permiso" />;

  // Viendo todas las sucursales, dos vendedores pueden llamarse igual: se distingue con el código.
  const verTodas = !usuario?.sucursal && (sucursal === null || sucursal.toLowerCase() === "todas");
  const nombreVendedor = (v: Vendedor) => (verTodas ? `${v.nombre} · ${v.sucursalCodigo}` : v.nombre);
  const nombreSucursal = (codigo: string) => sucursales.find((s) => s.codigo === codigo)?.nombre ?? codigo;

  // FiltroFechas ya revisó que la fecha inicial no sea posterior a la final.
  async function alMostrar({ desde, hasta }: RangoFechas) {
    setError(null);
    const esta = ++ultima.current;
    setCargando(true);
    try {
      const [filtrado, todos] = await Promise.all([
        vendedor ? obtenerFlujoDiario({ desde, hasta, sucursal, vendedor }) : null,
        obtenerFlujoDiario({ desde, hasta, sucursal, vendedor: null }),
      ]);
      if (esta !== ultima.current) return;
      setConsultado({ porVendedor: filtrado ?? todos, porDia: todos, numero: esta });
    } catch (err) {
      if (esta !== ultima.current) return;
      setConsultado(null);
      setError(mensajeDe(err, "No se pudo consultar el flujo diario."));
    } finally {
      if (esta === ultima.current) setCargando(false);
    }
  }

  const actualizando = cargando && consultado !== null;
  const total = pestana === "dia" ? consultado?.porDia.totalPorDia : consultado?.porVendedor.totalPorVendedor;
  const oficina = consultado?.porDia.porDia.reduce((s, d) => s + d.oficinaCentavos, 0) ?? 0;
  const detalleCobranza =
    pestana === "vendedor"
      ? "Solo lo que cobraron los vendedores"
      : oficina > 0 && total
        ? `Vendedores ${formatearPesos(total.cobranzaCentavos - oficina)} · Oficina ${formatearPesos(oficina)}`
        : undefined;

  return (
    <Pantalla>
      <EncabezadoPantalla
        titulo={TITULO}
        descripcion="Qué hizo cada vendedor en días pasados. Pica un vendedor o un número para ver el detalle."
      />

      <FiltroFechas
        id="fd"
        desde={desde}
        hasta={hasta}
        onCambio={(r) => {
          setDesde(r.desde);
          setHasta(r.hasta);
        }}
        onMostrar={(r) => void alMostrar(r)}
      >
        {/* "Por día" es de toda la sucursal: el vendedor solo filtra "Por vendedor". */}
        {pestana === "vendedor" && (
          <Campo id="fd-vendedor" etiqueta="Vendedor">
            <Lista value={vendedor} onChange={(e) => setVendedor(e.target.value)}>
              <option value="">Todos</option>
              {vendedores.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.activo ? nombreVendedor(v) : `${nombreVendedor(v)} (inactivo)`}
                </option>
              ))}
            </Lista>
          </Campo>
        )}
      </FiltroFechas>

      {error && <Aviso tono="error">{error}</Aviso>}

      {cargando && !consultado && <p className="text-sm text-muted-foreground">Cargando…</p>}
      {actualizando && <p className="text-sm text-muted-foreground">Actualizando…</p>}

      {consultado && total && (
        <div aria-busy={actualizando} className={`flex flex-col gap-5 ${actualizando ? "opacity-60" : ""}`}>
          <ResumenCifras
            totales={total}
            detalleCobranza={detalleCobranza}
            ultima={{
              titulo: "Visitas",
              valor: `${total.atendidosEnRuta} / ${total.clientesEnRuta}`,
              detalle: plural(total.rutas, "ruta", "rutas"),
            }}
          />
          <Pestanas
            etiqueta="Ver el flujo"
            valorInicial="vendedor"
            onCambio={(v) => setPestana(v === "dia" ? "dia" : "vendedor")}
            pestanas={[
              {
                valor: "vendedor",
                etiqueta: "Resultados por vendedor",
                contenido: (
                  <TablaPorVendedor key={consultado.numero} flujo={consultado.porVendedor} nombreSucursal={nombreSucursal} />
                ),
              },
              {
                valor: "dia",
                etiqueta: "Resultados por día",
                contenido: <TablaPorDia key={consultado.numero} flujo={consultado.porDia} nombreSucursal={nombreSucursal} />,
              },
            ]}
          />
        </div>
      )}
    </Pantalla>
  );
}
