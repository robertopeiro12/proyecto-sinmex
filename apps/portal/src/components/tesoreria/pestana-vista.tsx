"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { Aviso } from "@/components/ui/aviso";
import { BotonExcel } from "@/components/ui/boton-excel";
import { FiltroFechas } from "@/components/ui/filtro-fechas";
import { Monto } from "@/components/ui/monto";
import { CajaTabla, FilaTotal, Tabla, Td, TdMonto, Th } from "@/components/ui/tabla";
import { mensajeDe } from "@/lib/api";
import { exportarExcel } from "@/lib/excel/exportar";
import type { RangoFechas } from "@/lib/fechas";
import { etiquetaSucursal, formatearFecha } from "@/lib/reportes";
import {
  definicionExcelTesoreria,
  describirEvento,
  ETIQUETA_METODO,
  etiquetaSucursalCuenta,
  obtenerTesoreria,
  type VistaTesoreria,
} from "@/lib/tesoreria";
import { formatearPesos, hoyEnTijuana } from "@/lib/ventas";

function Pesos({ centavos }: { centavos: number | null }) {
  if (centavos === null) return <span className="text-muted-foreground">Sin saldo inicial</span>;
  return <Monto centavos={centavos} />;
}

/** Mostrar Tesorería (spec §5.2): saldo al inicio y al final por cuenta, total y saldos fijados del rango. */
export function PestanaVista({ sucursal, activa = true }: { sucursal: string | null; activa?: boolean }) {
  const { usuario } = useAuth();
  const hoy = hoyEnTijuana();
  const [rango, setRango] = useState<RangoFechas>({ desde: hoy, hasta: hoy });
  const [vista, setVista] = useState<VistaTesoreria | null>(null);
  const [cargando, setCargando] = useState(false);
  const [exportando, setExportando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ultima = useRef(0);

  const consultar = useCallback(
    async (d: string, h: string) => {
      setError(null);
      // FiltroFechas ya revisa el rango al picar Mostrar; esto cubre la re-consulta al volver a la pestaña.
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
    // Con una fecha vacía (FiltroFechas la deja pasar) no hay rango que repetir: no se consulta.
    if (activa && !eraActiva.current && rango.desde && rango.hasta) void consultar(rango.desde, rango.hasta);
    eraActiva.current = activa;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activa]);

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

  const t = vista?.total;

  return (
    <div className="flex flex-col gap-5">
      <FiltroFechas
        id="teso"
        desde={rango.desde}
        hasta={rango.hasta}
        onCambio={setRango}
        onMostrar={(r) => void consultar(r.desde, r.hasta)}
        acciones={<BotonExcel exportando={exportando} disabled={!vista || cargando} onClick={() => void alExportar()} />}
      />

      {error && <Aviso tono="error">{error}</Aviso>}
      {cargando && !vista && <p className="text-sm text-muted-foreground">Cargando…</p>}

      {vista && t && (
        <>
          <p className="text-sm text-muted-foreground">
            Del {formatearFecha(vista.desde)} al {formatearFecha(vista.hasta)}
          </p>
          {(vista.sinCuenta.length > 0 || vista.gastosSinCuenta.length > 0) && (
            <Aviso tono="advertencia">
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
            </Aviso>
          )}
          {vista.cuentas.length === 0 ? (
            <p className="text-sm text-muted-foreground">No hay cuentas. Dalas de alta en la pestaña Cuentas.</p>
          ) : (
            <CajaTabla>
              <Tabla aria-label="Tesorería por cuenta">
                <thead>
                  <tr>
                    <Th>Cuenta</Th>
                    <Th>Sucursal</Th>
                    <Th alinear="derecha">Saldo al inicio</Th>
                    <Th alinear="derecha">Entradas</Th>
                    <Th alinear="derecha">Salidas</Th>
                    <Th alinear="derecha">Saldo al final</Th>
                  </tr>
                </thead>
                <tbody>
                  {vista.cuentas.map((c) => (
                    <tr key={c.id}>
                      <Td>{c.nombre}</Td>
                      <Td className="whitespace-nowrap">{etiquetaSucursalCuenta(c.sucursalCodigo)}</Td>
                      <Td alinear="derecha" className="whitespace-nowrap">
                        <Pesos centavos={c.saldoInicioCentavos} />
                      </Td>
                      <TdMonto centavos={c.entradasCentavos} />
                      <TdMonto centavos={c.salidasCentavos} />
                      <Td alinear="derecha" className="whitespace-nowrap">
                        <Pesos centavos={c.saldoFinalCentavos} />
                        {c.saldoFijadoEnRango && (
                          <span className="block text-xs text-muted-foreground">saldo fijado el {formatearFecha(c.saldoFijadoEnRango)}</span>
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <FilaTotal>
                    <Td>Total Tesorería</Td>
                    <Td />
                    <Td alinear="derecha" className="whitespace-nowrap">
                      <Pesos centavos={t.saldoInicioCentavos} />
                      {t.cuentasConSaldoInicio < t.cuentas && (
                        <span className="block text-xs font-normal text-muted-foreground">
                          {t.cuentasConSaldoInicio} de {t.cuentas} cuentas con saldo
                        </span>
                      )}
                    </Td>
                    <TdMonto centavos={t.entradasCentavos} />
                    <TdMonto centavos={t.salidasCentavos} />
                    <Td alinear="derecha" className="whitespace-nowrap">
                      <Pesos centavos={t.saldoFinalCentavos} />
                      {t.cuentasConSaldoFinal < t.cuentas && (
                        <span className="block text-xs font-normal text-muted-foreground">
                          {t.cuentasConSaldoFinal} de {t.cuentas} cuentas con saldo
                        </span>
                      )}
                    </Td>
                  </FilaTotal>
                </tfoot>
              </Tabla>
            </CajaTabla>
          )}

          <div className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold">Movimientos del rango</h2>
            {vista.eventos.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin movimientos en el rango.</p>
            ) : (
              <CajaTabla>
                <Tabla aria-label="Movimientos del rango">
                  <thead>
                    <tr>
                      <Th>Fecha</Th>
                      <Th>Concepto</Th>
                      <Th>Cuenta</Th>
                      <Th alinear="derecha">Monto</Th>
                      <Th>Comentario</Th>
                      <Th>Capturó</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {vista.eventos.map((e) => {
                      const { concepto, cuenta, signo } = describirEvento(e);
                      const automatico = e.tipo === "cobranza" || e.tipo === "gasto-ruta";
                      return (
                        <tr key={e.id}>
                          <Td className="whitespace-nowrap">{formatearFecha(e.fecha)}</Td>
                          <Td>{concepto}</Td>
                          <Td>{cuenta}</Td>
                          <TdMonto centavos={signo === -1 ? -e.montoCentavos : e.montoCentavos} />
                          <Td>{automatico ? "—" : (e.comentario ?? "—")}</Td>
                          <Td>{automatico ? "—" : e.capturo}</Td>
                        </tr>
                      );
                    })}
                  </tbody>
                </Tabla>
              </CajaTabla>
            )}
          </div>
        </>
      )}
    </div>
  );
}
