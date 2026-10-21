"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { Aviso } from "@/components/ui/aviso";
import { BotonExcel } from "@/components/ui/boton-excel";
import { EncabezadoPantalla, Pantalla } from "@/components/ui/encabezado-pantalla";
import { EstadoPantalla } from "@/components/ui/estado-pantalla";
import { FiltroFechas } from "@/components/ui/filtro-fechas";
import { Monto } from "@/components/ui/monto";
import { CajaTabla, Tabla, Td, TdMonto, Th } from "@/components/ui/tabla";
import { mensajeDe } from "@/lib/api";
import { exportarExcel } from "@/lib/excel/exportar";
import {
  definicionExcelFlujo,
  formatearPorcentaje,
  obtenerFlujoEfectivo,
  type FlujoEfectivo,
} from "@/lib/flujo-efectivo";
import type { RangoFechas } from "@/lib/fechas";
import { etiquetaSucursal, formatearFecha } from "@/lib/reportes";
import { hoyEnTijuana } from "@/lib/ventas";

const NOTA_GASTOS = "sin gastos registrados todavía (llegan con Compras y Egresos)";

interface FilaResumen {
  concepto: string;
  valor: React.ReactNode;
  negritas?: boolean;
  nota?: string;
}

function filasResumen(f: FlujoEfectivo): FilaResumen[] {
  const nota = f.gastosDisponibles ? undefined : NOTA_GASTOS;
  return [
    { concepto: "Ventas Totales", valor: <Monto centavos={f.ventasTotalesCentavos} /> },
    { concepto: "Ventas Repartidor", valor: <Monto centavos={f.cobradoRepartidorCentavos} /> },
    { concepto: "Ventas Oficinas", valor: <Monto centavos={f.cobradoOficinaCentavos} /> },
    { concepto: "Ventas Cobradas", valor: <Monto centavos={f.ventasCobradasCentavos} /> },
    { concepto: "% de Cobro", valor: formatearPorcentaje(f.porcentajeCobro) },
    { concepto: "Gastos de Producción", valor: <Monto centavos={f.gastosProduccionCentavos} />, nota },
    { concepto: "Utilidad Bruta", valor: <Monto centavos={f.utilidadBrutaCentavos} />, negritas: true },
    { concepto: "Gastos Operativos", valor: <Monto centavos={f.gastosOperacionCentavos} />, nota },
    { concepto: "Utilidad de Operación", valor: <Monto centavos={f.utilidadOperacionCentavos} />, negritas: true },
    { concepto: "Gastos Financieros", valor: <Monto centavos={f.gastosFinancierosCentavos} />, nota },
    { concepto: "Utilidad Neta", valor: <Monto centavos={f.utilidadNetaCentavos} />, negritas: true },
    {
      concepto: "Total Tesorería",
      valor: <Monto centavos={f.totalTesoreriaCentavos} />,
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
 * Finanzas → Flujo de Efectivo (T-32): solo lectura. FiltroFechas revisa el rango antes de consultar. La página la monta con `key={sucursal}`.
 */
export function PantallaFlujoEfectivo({ sucursal }: { sucursal: string | null }) {
  const { puede, usuario, cargando: cargandoSesion } = useAuth();
  const permitido = puede("flujo_efectivo.ver");
  const hoy = hoyEnTijuana();
  const [rango, setRango] = useState<RangoFechas>({ desde: hoy, hasta: hoy });
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

  if (cargandoSesion) return <EstadoPantalla titulo="Flujo de Efectivo" tipo="cargando" />;
  if (!permitido) return <EstadoPantalla titulo="Flujo de Efectivo" tipo="sin-permiso" />;

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

  return (
    <Pantalla>
      <EncabezadoPantalla
        titulo="Flujo de Efectivo"
        descripcion="Ventas, cobranza, gastos y utilidades de un rango de fechas."
      />

      <FiltroFechas
        id="flujo"
        desde={rango.desde}
        hasta={rango.hasta}
        onCambio={setRango}
        onMostrar={(r) => void consultar(r.desde, r.hasta)}
        acciones={<BotonExcel exportando={exportando} disabled={!flujo || cargando} onClick={() => void alExportar()} />}
      />

      {error && <Aviso tono="error">{error}</Aviso>}

      {cargando && !consultado && <p className="text-sm text-muted-foreground">Cargando…</p>}
      {actualizando && <p className="text-sm text-muted-foreground">Actualizando…</p>}

      {flujo && (
        <div aria-busy={actualizando} className={`flex flex-col gap-6 ${actualizando ? "opacity-60" : ""}`}>
          <p className="text-sm text-muted-foreground">
            {`Del ${formatearFecha(flujo.desde)} al ${formatearFecha(flujo.hasta)} · Sucursal: ${consultado!.sucursal}`}
          </p>

          <CajaTabla className="w-fit max-w-full">
            <Tabla aria-label="Flujo de Efectivo">
              <tbody>
                {filasResumen(flujo).map((f) => (
                  <tr key={f.concepto} className={f.negritas ? "font-semibold" : undefined}>
                    <Td className="whitespace-nowrap">{f.concepto}</Td>
                    <Td alinear="derecha" className="whitespace-nowrap">
                      {f.valor}
                    </Td>
                    <Td className="text-xs font-normal text-muted-foreground">{f.nota}</Td>
                  </tr>
                ))}
              </tbody>
            </Tabla>
          </CajaTabla>

          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">Desglose por día</h3>
            {flujo.dias.length === 0 ? (
              <p className="text-sm text-muted-foreground">No hay ventas ni cobranza en ese rango.</p>
            ) : (
              <CajaTabla>
                <Tabla aria-label="Desglose por día">
                  <thead>
                    <tr>
                      <Th>Fecha</Th>
                      <Th alinear="derecha">Ventas</Th>
                      <Th alinear="derecha">Cobrado repartidor</Th>
                      <Th alinear="derecha">Cobrado oficina</Th>
                      <Th alinear="derecha">% de cobro</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {flujo.dias.map((d) => (
                      <tr key={d.fecha}>
                        <Td>{formatearFecha(d.fecha)}</Td>
                        <TdMonto centavos={d.ventasCentavos} />
                        <TdMonto centavos={d.cobradoRepartidorCentavos} />
                        <TdMonto centavos={d.cobradoOficinaCentavos} />
                        <Td alinear="derecha">{formatearPorcentaje(d.porcentajeCobro)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Tabla>
              </CajaTabla>
            )}
          </div>

          <section aria-label="Comentarios" className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div className="flex min-w-0 flex-col gap-2">
              <h3 className="text-sm font-semibold">Comentarios de ingresos</h3>
              {flujo.comentarios.ingresos.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sin comentarios en el rango.</p>
              ) : (
                <CajaTabla>
                  <Tabla aria-label="Comentarios de ingresos">
                    <thead>
                      <tr>
                        <Th>Fecha</Th>
                        <Th>Folio</Th>
                        <Th>Cliente</Th>
                        <Th>Comentario</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {flujo.comentarios.ingresos.map((c, i) => (
                        <tr key={i} className="align-top">
                          <Td className="whitespace-nowrap">{formatearFecha(c.fecha)}</Td>
                          <Td className="whitespace-nowrap">{c.folio}</Td>
                          <Td>{c.cliente}</Td>
                          <Td>{c.comentario}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </Tabla>
                </CajaTabla>
              )}
            </div>
            <div className="flex min-w-0 flex-col gap-2">
              <h3 className="text-sm font-semibold">Comentarios de egresos</h3>
              {flujo.comentarios.egresos.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sin comentarios en el rango.</p>
              ) : (
                <CajaTabla>
                  <Tabla aria-label="Comentarios de egresos">
                    <thead>
                      <tr>
                        <Th>Fecha</Th>
                        <Th>Concepto</Th>
                        <Th>Cuenta</Th>
                        <Th alinear="derecha">Monto</Th>
                        <Th>Comentario</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {flujo.comentarios.egresos.map((c, i) => (
                        <tr key={i} className="align-top">
                          <Td className="whitespace-nowrap">{formatearFecha(c.fecha)}</Td>
                          <Td>{c.concepto}</Td>
                          <Td>{c.cuenta}</Td>
                          <TdMonto centavos={c.montoCentavos} />
                          <Td>{c.comentario}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </Tabla>
                </CajaTabla>
              )}
            </div>
          </section>
        </div>
      )}
    </Pantalla>
  );
}
