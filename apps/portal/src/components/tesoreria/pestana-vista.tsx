"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/components/auth/auth-provider";
import { mensajeDe } from "@/lib/api";
import { exportarExcel } from "@/lib/excel/exportar";
import { rangoMes, rangoSemana } from "@/lib/reporte-ventas";
import { etiquetaSucursal, formatearFecha } from "@/lib/reportes";
import {
  definicionExcelTesoreria,
  diaAnterior,
  describirEvento,
  ETIQUETA_METODO,
  etiquetaSucursalCuenta,
  obtenerTesoreria,
  type VistaTesoreria,
} from "@/lib/tesoreria";
import { formatearPesos, hoyEnTijuana } from "@/lib/ventas";

function Pesos({ centavos }: { centavos: number | null }) {
  if (centavos === null) return <span className="text-muted-foreground">Sin saldo inicial</span>;
  return <span className={centavos < 0 ? "text-destructive" : ""}>{formatearPesos(centavos)}</span>;
}

/** Mostrar Tesorería (spec §5.2): saldo al inicio y al final por cuenta, total y saldos fijados del rango. */
export function PestanaVista({ sucursal, activa = true }: { sucursal: string | null; activa?: boolean }) {
  const { usuario } = useAuth();
  const hoy = hoyEnTijuana();
  const [desde, setDesde] = useState(hoy);
  const [hasta, setHasta] = useState(hoy);
  const [vista, setVista] = useState<VistaTesoreria | null>(null);
  const [cargando, setCargando] = useState(false);
  const [exportando, setExportando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ultima = useRef(0);

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
        const r = await obtenerTesoreria({ desde: d, hasta: h, sucursal });
        if (esta === ultima.current) setVista(r);
      } catch (err) {
        if (esta !== ultima.current) return;
        setVista(null);
        setError(mensajeDe(err, "No se pudo consultar la Tesorería."));
      } finally {
        if (esta === ultima.current) setCargando(false);
      }
    },
    [sucursal],
  );

  // "Por default, la fecha actual" (fuente): consulta hoy al abrir.
  useEffect(() => {
    void consultar(hoy, hoy);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consultar]);

  // La pestaña se queda montada: al volver a ella se repite la ultima consulta (el rango tecleado,
  // aun sin "Mostrar") para no ensenar numeros viejos tras guardar saldos en la pestaña Saldos.
  const eraActiva = useRef(activa);
  useEffect(() => {
    if (activa && !eraActiva.current) void consultar(desde, hasta);
    eraActiva.current = activa;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activa]);

  function aplicar(r: { desde: string; hasta: string }) {
    setDesde(r.desde);
    setHasta(r.hasta);
  }

  function alMostrar(e: FormEvent) {
    e.preventDefault();
    void consultar(desde, hasta);
  }

  async function alExportar() {
    if (!vista) return;
    setExportando(true);
    try {
      await exportarExcel(
        definicionExcelTesoreria(vista, { sucursal: etiquetaSucursal(usuario?.sucursal?.codigo ?? null, sucursal) }),
      );
    } catch {
      setError("No se pudo generar el Excel.");
    } finally {
      setExportando(false);
    }
  }

  const ayer = diaAnterior(hoy);
  const t = vista?.total;

  return (
    <div className="flex flex-col gap-5">
      <form onSubmit={alMostrar} className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="teso-desde" className="text-sm font-medium">
            Desde
          </label>
          <input id="teso-desde" type="date" required value={desde} onChange={(e) => setDesde(e.target.value)} className="rounded-md border px-3 py-2 text-sm" />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="teso-hasta" className="text-sm font-medium">
            Hasta
          </label>
          <input id="teso-hasta" type="date" required value={hasta} onChange={(e) => setHasta(e.target.value)} className="rounded-md border px-3 py-2 text-sm" />
        </div>
        <div className="flex items-end gap-1">
          <Button type="button" variant="ghost" size="sm" onClick={() => aplicar({ desde: hoy, hasta: hoy })}>
            Hoy
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => aplicar({ desde: ayer, hasta: ayer })}>
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
        <Button type="button" variant="outline" disabled={!vista || exportando || cargando} onClick={() => void alExportar()}>
          Exportar a Excel
        </Button>
      </form>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {cargando && !vista && <p className="text-sm text-muted-foreground">Cargando…</p>}

      {vista && t && (
        <>
          <p className="text-sm text-muted-foreground">
            Del {formatearFecha(vista.desde)} al {formatearFecha(vista.hasta)}
          </p>
          {(vista.sinCuenta.length > 0 || vista.gastosSinCuenta.length > 0) && (
            <div role="status" className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {vista.sinCuenta.map((s) => (
                <p key={`${s.sucursalCodigo}:${s.metodo}`}>
                  {formatearPesos(s.montoCentavos)} de cobranza de {s.sucursalCodigo} ({ETIQUETA_METODO[s.metodo].toLowerCase()}) sin cuenta asignada
                </p>
              ))}
              {vista.sinCuenta.length > 0 && (
                <p className="text-xs">Configúrala en Cuentas → ¿A qué cuenta entra la cobranza?</p>
              )}
              {vista.gastosSinCuenta.map((g) => (
                <p key={`gasto:${g.sucursalCodigo}`}>
                  {formatearPesos(g.montoCentavos)} de gastos de ruta de {g.sucursalCodigo} sin cuenta de efectivo
                </p>
              ))}
              {vista.gastosSinCuenta.length > 0 && (
                <p className="text-xs">
                  Los gastos de ruta salen de la cuenta que recibe la cobranza en efectivo de su sucursal: configúrala en
                  Cuentas → ¿A qué cuenta entra la cobranza?
                </p>
              )}
            </div>
          )}
          {vista.cuentas.length === 0 ? (
            <p className="text-sm text-muted-foreground">No hay cuentas. Dalas de alta en la pestaña Cuentas.</p>
          ) : (
            <table className="w-full text-sm" aria-label="Tesorería por cuenta">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">Cuenta</th>
                  <th className="py-2 pr-4 font-medium">Sucursal</th>
                  <th className="py-2 pr-4 text-right font-medium">Saldo al inicio</th>
                  <th className="py-2 pr-4 text-right font-medium">Entradas</th>
                  <th className="py-2 pr-4 text-right font-medium">Salidas</th>
                  <th className="py-2 text-right font-medium">Saldo al final</th>
                </tr>
              </thead>
              <tbody>
                {vista.cuentas.map((c) => (
                  <tr key={c.id} className="border-b">
                    <td className="py-2 pr-4">{c.nombre}</td>
                    <td className="whitespace-nowrap py-2 pr-4">{etiquetaSucursalCuenta(c.sucursalCodigo)}</td>
                    <td className="whitespace-nowrap py-2 pr-4 text-right tabular-nums">
                      <Pesos centavos={c.saldoInicioCentavos} />
                    </td>
                    <td className="whitespace-nowrap py-2 pr-4 text-right tabular-nums">{formatearPesos(c.entradasCentavos)}</td>
                    <td className="whitespace-nowrap py-2 pr-4 text-right tabular-nums">{formatearPesos(c.salidasCentavos)}</td>
                    <td className="whitespace-nowrap py-2 text-right tabular-nums">
                      <Pesos centavos={c.saldoFinalCentavos} />
                      {c.saldoFijadoEnRango && (
                        <span className="block text-xs text-muted-foreground">saldo fijado el {formatearFecha(c.saldoFijadoEnRango)}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 font-semibold">
                  <td className="py-2 pr-4">Total Tesorería</td>
                  <td className="py-2 pr-4"></td>
                  <td className="whitespace-nowrap py-2 pr-4 text-right tabular-nums">
                    <Pesos centavos={t.saldoInicioCentavos} />
                    {t.cuentasConSaldoInicio < t.cuentas && (
                      <span className="block text-xs font-normal text-muted-foreground">
                        {t.cuentasConSaldoInicio} de {t.cuentas} cuentas con saldo
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap py-2 pr-4 text-right tabular-nums">{formatearPesos(t.entradasCentavos)}</td>
                  <td className="whitespace-nowrap py-2 pr-4 text-right tabular-nums">{formatearPesos(t.salidasCentavos)}</td>
                  <td className="whitespace-nowrap py-2 text-right tabular-nums">
                    <Pesos centavos={t.saldoFinalCentavos} />
                    {t.cuentasConSaldoFinal < t.cuentas && (
                      <span className="block text-xs font-normal text-muted-foreground">
                        {t.cuentasConSaldoFinal} de {t.cuentas} cuentas con saldo
                      </span>
                    )}
                  </td>
                </tr>
              </tfoot>
            </table>
          )}

          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">Movimientos del rango</h3>
            {vista.eventos.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin movimientos en el rango.</p>
            ) : (
              <table className="w-full text-sm" aria-label="Movimientos del rango">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 pr-4 font-medium">Fecha</th>
                    <th className="py-2 pr-4 font-medium">Concepto</th>
                    <th className="py-2 pr-4 font-medium">Cuenta</th>
                    <th className="py-2 pr-4 text-right font-medium">Monto</th>
                    <th className="py-2 pr-4 font-medium">Comentario</th>
                    <th className="py-2 font-medium">Capturó</th>
                  </tr>
                </thead>
                <tbody>
                  {vista.eventos.map((e) => {
                    const { concepto, cuenta, signo } = describirEvento(e);
                    return (
                      <tr key={e.id} className="border-b last:border-0">
                        <td className="whitespace-nowrap py-2 pr-4">{formatearFecha(e.fecha)}</td>
                        <td className="py-2 pr-4">{concepto}</td>
                        <td className="py-2 pr-4">{cuenta}</td>
                        <td className="whitespace-nowrap py-2 pr-4 text-right tabular-nums">
                          <Pesos centavos={signo === -1 ? -e.montoCentavos : e.montoCentavos} />
                        </td>
                        <td className="py-2 pr-4">
                          {e.tipo === "cobranza" || e.tipo === "gasto-ruta" ? "—" : (e.comentario ?? "—")}
                        </td>
                        <td className="py-2">{e.tipo === "cobranza" || e.tipo === "gasto-ruta" ? "—" : e.capturo}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}
