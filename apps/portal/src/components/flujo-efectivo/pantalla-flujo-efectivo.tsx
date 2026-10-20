"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/components/auth/auth-provider";
import { mensajeDe } from "@/lib/api";
import { exportarExcel } from "@/lib/excel/exportar";
import {
  definicionExcelFlujo,
  formatearPorcentaje,
  obtenerFlujoEfectivo,
  type FlujoEfectivo,
} from "@/lib/flujo-efectivo";
import { diaAnterior, rangoMes, rangoSemana } from "@/lib/fechas";
import { etiquetaSucursal, formatearFecha } from "@/lib/reportes";
import { formatearPesos, hoyEnTijuana } from "@/lib/ventas";

const NOTA_GASTOS = "sin gastos registrados todavía (llegan con Compras y Egresos)";

function Pesos({ centavos }: { centavos: number }) {
  return <span className={centavos < 0 ? "text-destructive" : ""}>{formatearPesos(centavos)}</span>;
}

interface FilaResumen {
  concepto: string;
  valor: React.ReactNode;
  negritas?: boolean;
  nota?: string;
}

function filasResumen(f: FlujoEfectivo): FilaResumen[] {
  const nota = f.gastosDisponibles ? undefined : NOTA_GASTOS;
  return [
    { concepto: "Ventas Totales", valor: <Pesos centavos={f.ventasTotalesCentavos} /> },
    { concepto: "Ventas Repartidor", valor: <Pesos centavos={f.cobradoRepartidorCentavos} /> },
    { concepto: "Ventas Oficinas", valor: <Pesos centavos={f.cobradoOficinaCentavos} /> },
    { concepto: "Ventas Cobradas", valor: <Pesos centavos={f.ventasCobradasCentavos} /> },
    { concepto: "% de Cobro", valor: formatearPorcentaje(f.porcentajeCobro) },
    { concepto: "Gastos de Producción", valor: <Pesos centavos={f.gastosProduccionCentavos} />, nota },
    { concepto: "Utilidad Bruta", valor: <Pesos centavos={f.utilidadBrutaCentavos} />, negritas: true },
    { concepto: "Gastos Operativos", valor: <Pesos centavos={f.gastosOperacionCentavos} />, nota },
    { concepto: "Utilidad de Operación", valor: <Pesos centavos={f.utilidadOperacionCentavos} />, negritas: true },
    { concepto: "Gastos Financieros", valor: <Pesos centavos={f.gastosFinancierosCentavos} />, nota },
    { concepto: "Utilidad Neta", valor: <Pesos centavos={f.utilidadNetaCentavos} />, negritas: true },
    {
      concepto: "Total Tesorería",
      valor: <Pesos centavos={f.totalTesoreriaCentavos} />,
      negritas: true,
      nota:
        f.tesoreriaCuentasConSaldo < f.tesoreriaCuentas
          ? `${f.tesoreriaCuentasConSaldo} de ${f.tesoreriaCuentas} cuentas con saldo`
          : undefined,
    },
  ];
}

interface Consultado {
  flujo: FlujoEfectivo;
  sucursal: string;
}

/**
 * Finanzas → Flujo de Efectivo (T-32): solo lectura. La página la monta con `key={sucursal}`.
 */
export function PantallaFlujoEfectivo({ sucursal }: { sucursal: string | null }) {
  const { puede, usuario, cargando: cargandoSesion } = useAuth();
  const permitido = puede("flujo_efectivo.ver");
  const hoy = hoyEnTijuana();
  const [desde, setDesde] = useState(hoy);
  const [hasta, setHasta] = useState(hoy);
  const [consultado, setConsultado] = useState<Consultado | null>(null);
  const [cargando, setCargando] = useState(false);
  const [exportando, setExportando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Solo la última consulta escribe: una lenta que llega tarde no pisa a la nueva.
  const ultima = useRef(0);
  const etiqueta = etiquetaSucursal(usuario?.sucursal?.codigo ?? null, sucursal);

  const consultar = useCallback(
    async (d: string, h: string) => {
      setError(null);
      if (d > h) {
        setError("La fecha inicial no puede ser posterior a la final.");
        return;
      }
      const esta = ++ultima.current;
      setCargando(true);
      try {
        const flujo = await obtenerFlujoEfectivo({ desde: d, hasta: h, sucursal });
        if (esta === ultima.current) setConsultado({ flujo, sucursal: etiqueta });
      } catch (err) {
        if (esta !== ultima.current) return;
        setConsultado(null);
        setError(mensajeDe(err, "No se pudo consultar el Flujo de Efectivo."));
      } finally {
        if (esta === ultima.current) setCargando(false);
      }
    },
    [sucursal, etiqueta],
  );

  // Por default, la fecha actual: consulta hoy al abrir.
  useEffect(() => {
    if (!permitido) return;
    void consultar(hoy, hoy);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permitido, sucursal]);

  if (cargandoSesion) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Flujo de Efectivo</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Cargando…</p>
        </CardContent>
      </Card>
    );
  }

  if (!permitido) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Flujo de Efectivo</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No tienes permiso para ver el Flujo de Efectivo</p>
        </CardContent>
      </Card>
    );
  }

  function aplicar(r: { desde: string; hasta: string }) {
    setDesde(r.desde);
    setHasta(r.hasta);
  }

  function alMostrar(e: FormEvent) {
    e.preventDefault();
    void consultar(desde, hasta);
  }

  async function alExportar() {
    if (!consultado) return;
    setError(null);
    setExportando(true);
    try {
      await exportarExcel(definicionExcelFlujo(consultado.flujo, { sucursal: consultado.sucursal }));
    } catch {
      setError("No se pudo generar el Excel.");
    } finally {
      setExportando(false);
    }
  }

  const flujo = consultado?.flujo ?? null;
  const actualizando = cargando && consultado !== null;
  const celda = "px-3 py-2";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Flujo de Efectivo</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <form onSubmit={alMostrar} className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="fe-desde" className="text-sm font-medium">
              Desde
            </label>
            <input
              id="fe-desde"
              type="date"
              required
              value={desde}
              onChange={(e) => setDesde(e.target.value)}
              className="rounded-md border px-3 py-2 text-sm"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="fe-hasta" className="text-sm font-medium">
              Hasta
            </label>
            <input
              id="fe-hasta"
              type="date"
              required
              value={hasta}
              onChange={(e) => setHasta(e.target.value)}
              className="rounded-md border px-3 py-2 text-sm"
            />
          </div>
          <div className="flex items-end gap-1">
            <Button type="button" variant="ghost" size="sm" onClick={() => aplicar({ desde: hoy, hasta: hoy })}>
              Hoy
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => aplicar({ desde: diaAnterior(hoy), hasta: diaAnterior(hoy) })}
            >
              Ayer
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => aplicar(rangoSemana(hoy))}>
              Esta semana
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => aplicar(rangoMes(hoy))}>
              Este mes
            </Button>
          </div>
          <Button type="submit">Mostrar</Button>
          <Button
            type="button"
            variant="outline"
            disabled={!flujo || exportando || cargando}
            onClick={() => void alExportar()}
          >
            Exportar a Excel
          </Button>
        </form>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        {cargando && !consultado && <p className="text-sm text-muted-foreground">Cargando…</p>}
        {actualizando && <p className="text-sm text-muted-foreground">Actualizando…</p>}

        {flujo && (
          <div aria-busy={actualizando} className={`flex flex-col gap-6 ${actualizando ? "opacity-60" : ""}`}>
            <p className="text-sm text-muted-foreground">
              {`Del ${formatearFecha(flujo.desde)} al ${formatearFecha(flujo.hasta)} · Sucursal: ${consultado!.sucursal}`}
            </p>

            <table aria-label="Flujo de Efectivo" className="w-full max-w-3xl text-sm">
              <tbody>
                {filasResumen(flujo).map((f) => (
                  <tr key={f.concepto} className={`border-b ${f.negritas ? "font-semibold" : ""}`}>
                    <td className={`${celda} whitespace-nowrap`}>{f.concepto}</td>
                    <td className={`${celda} whitespace-nowrap text-right tabular-nums`}>{f.valor}</td>
                    <td className={`${celda} text-xs font-normal text-muted-foreground`}>{f.nota}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold">Desglose por día</h3>
              {flujo.dias.length === 0 ? (
                <p className="text-sm text-muted-foreground">No hay ventas ni cobranza en ese rango.</p>
              ) : (
                <table aria-label="Desglose por día" className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className={`${celda} font-medium`}>Fecha</th>
                      <th className={`${celda} text-right font-medium`}>Ventas</th>
                      <th className={`${celda} text-right font-medium`}>Cobrado repartidor</th>
                      <th className={`${celda} text-right font-medium`}>Cobrado oficina</th>
                      <th className={`${celda} text-right font-medium`}>% de cobro</th>
                    </tr>
                  </thead>
                  <tbody>
                    {flujo.dias.map((d) => (
                      <tr key={d.fecha} className="border-b">
                        <td className={celda}>{formatearFecha(d.fecha)}</td>
                        <td className={`${celda} text-right tabular-nums`}>{formatearPesos(d.ventasCentavos)}</td>
                        <td className={`${celda} text-right tabular-nums`}>
                          {formatearPesos(d.cobradoRepartidorCentavos)}
                        </td>
                        <td className={`${celda} text-right tabular-nums`}>
                          {formatearPesos(d.cobradoOficinaCentavos)}
                        </td>
                        <td className={`${celda} text-right tabular-nums`}>{formatearPorcentaje(d.porcentajeCobro)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <section aria-label="Comentarios" className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <div className="flex flex-col gap-2">
                <h3 className="text-sm font-semibold">Comentarios de ingresos</h3>
                {flujo.comentarios.ingresos.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Sin comentarios en el rango.</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-muted-foreground">
                        <th className={`${celda} font-medium`}>Fecha</th>
                        <th className={`${celda} font-medium`}>Folio</th>
                        <th className={`${celda} font-medium`}>Cliente</th>
                        <th className={`${celda} font-medium`}>Comentario</th>
                      </tr>
                    </thead>
                    <tbody>
                      {flujo.comentarios.ingresos.map((c, i) => (
                        <tr key={i} className="border-b align-top">
                          <td className={`${celda} whitespace-nowrap`}>{formatearFecha(c.fecha)}</td>
                          <td className={`${celda} whitespace-nowrap`}>{c.folio}</td>
                          <td className={celda}>{c.cliente}</td>
                          <td className={celda}>{c.comentario}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
              <div className="flex flex-col gap-2">
                <h3 className="text-sm font-semibold">Comentarios de egresos</h3>
                {flujo.comentarios.egresos.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Sin comentarios en el rango.</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-muted-foreground">
                        <th className={`${celda} font-medium`}>Fecha</th>
                        <th className={`${celda} font-medium`}>Concepto</th>
                        <th className={`${celda} font-medium`}>Cuenta</th>
                        <th className={`${celda} text-right font-medium`}>Monto</th>
                        <th className={`${celda} font-medium`}>Comentario</th>
                      </tr>
                    </thead>
                    <tbody>
                      {flujo.comentarios.egresos.map((c, i) => (
                        <tr key={i} className="border-b align-top">
                          <td className={`${celda} whitespace-nowrap`}>{formatearFecha(c.fecha)}</td>
                          <td className={celda}>{c.concepto}</td>
                          <td className={celda}>{c.cuenta}</td>
                          <td className={`${celda} text-right tabular-nums`}>{formatearPesos(c.montoCentavos)}</td>
                          <td className={celda}>{c.comentario}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </section>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
