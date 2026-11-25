"use client";

import { useEffect, useRef, useState } from "react";
import { Aviso } from "@/components/ui/aviso";
import { Campo, Entrada } from "@/components/ui/campo";
import { CajaTabla, Fila, FilaTotal, FilaVacia, Tabla, Td, Th } from "@/components/ui/tabla";
import { Ventana } from "@/components/ui/ventana";
import { mensajeDe } from "@/lib/api";
import { diaAnterior } from "@/lib/fechas";
import { formatearDiaCorto } from "@/lib/formato";
import {
  diasDelRango,
  leerDescuentosPt,
  leerHistorialPt,
  MAX_DIAS_HISTORIAL,
  textoCambios,
  textoOrigenDescuento,
  textoRango,
  totalesHistorial,
  type CualPt,
  type DescuentosPt,
  type DiaPt,
  type RenglonPt,
} from "@/lib/inventario-pt";
import { CeldasPt, ColumnasPt, EncabezadosPt, InicialConMarca, nombreDe, SEPARADOR } from "./tabla-inventario-pt";

/** La presentación o el producto del renglón picado (en la vista por producto no hay presentación). */
export function cualDe(r: RenglonPt): CualPt {
  return r.presentacionId ? { presentacion: r.presentacionId } : { producto: r.productoId };
}

/** Los 7 días que terminan en `hasta` (D4). */
function semanaQueTermina(hasta: string): string {
  let d = hasta;
  for (let i = 0; i < 6; i++) d = diaAnterior(d);
  return d;
}

/**
 * D4: los días de un producto o presentación (por omisión los 7 que terminan en el elegido;
 * Desde/Hasta hasta 62 días), con el total de los movimientos. Inicial, Final y Merma
 * acumulada no se suman: son saldos.
 */
export function VentanaHistorial({
  renglon,
  fecha,
  hoy,
  sucursal,
  alCerrar,
}: {
  renglon: RenglonPt;
  fecha: string;
  hoy: string;
  sucursal: string;
  alCerrar: () => void;
}) {
  const [desde, setDesde] = useState(() => semanaQueTermina(fecha));
  const [hasta, setHasta] = useState(fecha);
  const [dias, setDias] = useState<DiaPt[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ultima = useRef(0);
  const nombre = nombreDe(renglon);

  const problema =
    desde === "" || hasta === ""
      ? "Elige las dos fechas."
      : desde > hasta
        ? "Desde no puede ser después de Hasta."
        : hasta > hoy
          ? "Hasta no puede ser posterior a hoy."
          : diasDelRango(desde, hasta) > MAX_DIAS_HISTORIAL
            ? `Elige ${MAX_DIAS_HISTORIAL} días o menos.`
            : null;

  useEffect(() => {
    if (problema) return;
    const esta = ++ultima.current;
    leerHistorialPt(cualDe(renglon), desde, hasta, sucursal)
      .then((r) => {
        if (esta !== ultima.current) return;
        setDias(r.dias);
        setError(null);
      })
      .catch((err: unknown) => {
        if (esta !== ultima.current) return;
        setDias(null);
        setError(mensajeDe(err, "No se pudieron cargar los días."));
      });
  }, [desde, hasta, sucursal, renglon, problema]);

  const total = dias ? totalesHistorial(dias) : null;

  return (
    <Ventana abierta alCerrar={alCerrar} ancho="detalle" titulo={`${nombre} · ${textoRango(desde || fecha, hasta || fecha)}`}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end gap-3">
          <Campo id="pt-historial-desde" etiqueta="Desde" className="w-44">
            <Entrada type="date" max={hoy} value={desde} onChange={(e) => setDesde(e.target.value)} />
          </Campo>
          <Campo id="pt-historial-hasta" etiqueta="Hasta" className="w-44">
            <Entrada type="date" max={hoy} value={hasta} onChange={(e) => setHasta(e.target.value)} />
          </Campo>
        </div>
        {problema && <Aviso tono="advertencia">{problema}</Aviso>}
        {error && <Aviso tono="error">{error}</Aviso>}
        {!problema && dias === null && !error && <p className="text-sm text-muted-foreground">Cargando…</p>}
        {!problema && dias && total && (
          <CajaTabla>
            <Tabla aria-label={`Días de ${nombre}`} className="table-fixed">
              <ColumnasPt primera="w-[10%]" />
              <thead>
                <EncabezadosPt primera="Día" corto />
              </thead>
              <tbody>
                {dias.length === 0 && <FilaVacia columnas={13}>Sin días en ese rango.</FilaVacia>}
                {dias.map((d) => (
                  <Fila key={d.fecha} className={d.fecha === fecha ? "bg-menu/60" : undefined}>
                    <Td className="whitespace-nowrap">{formatearDiaCorto(d.fecha)}</Td>
                    <CeldasPt r={d} inicial={<InicialConMarca r={d} />} />
                  </Fila>
                ))}
              </tbody>
              {dias.length > 0 && (
                <tfoot>
                  <FilaTotal>
                    <Td>Total</Td>
                    <Td />
                    <Td alinear="derecha">{total.ventas}</Td>
                    <Td alinear="derecha">{total.merma}</Td>
                    <Td alinear="derecha">{total.consumo}</Td>
                    <Td alinear="derecha">{total.promo}</Td>
                    <Td alinear="derecha">{total.descuentos}</Td>
                    <Td alinear="derecha">{textoCambios(total.cambios)}</Td>
                    <Td alinear="derecha">{total.entradas}</Td>
                    <Td alinear="derecha">{total.envios}</Td>
                    <Td />
                    <Td className={SEPARADOR} />
                    <Td alinear="derecha">{total.retiroMerma}</Td>
                  </FilaTotal>
                </tfoot>
              )}
            </Tabla>
          </CajaTabla>
        )}
      </div>
    </Ventana>
  );
}

/** D4: a quién se le descontó (vendedor del corte o trabajador de nómina) ese día. */
export function VentanaDescuentos({
  renglon,
  fecha,
  sucursal,
  alCerrar,
}: {
  renglon: RenglonPt;
  fecha: string;
  sucursal: string;
  alCerrar: () => void;
}) {
  const [datos, setDatos] = useState<DescuentosPt | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vigente = true;
    leerDescuentosPt(cualDe(renglon), fecha, sucursal).then(
      (r) => vigente && setDatos(r),
      (err: unknown) => vigente && setError(mensajeDe(err, "No se pudieron cargar los descuentos.")),
    );
    return () => {
      vigente = false;
    };
  }, [renglon, fecha, sucursal]);

  return (
    <Ventana abierta alCerrar={alCerrar} ancho="ancho" titulo={`Descuentos · ${nombreDe(renglon)} · ${formatearDiaCorto(fecha)}`}>
      {error && <Aviso tono="error">{error}</Aviso>}
      {!datos && !error && <p className="text-sm text-muted-foreground">Cargando…</p>}
      {datos && (
        <CajaTabla>
          <Tabla aria-label="A quién">
            <thead>
              <tr>
                <Th>A quién</Th>
                <Th>De dónde</Th>
                <Th alinear="derecha">Piezas</Th>
              </tr>
            </thead>
            <tbody>
              {datos.detalle.length === 0 && <FilaVacia columnas={3}>Sin descuentos ese día.</FilaVacia>}
              {datos.detalle.map((d) => (
                <Fila key={`${d.quien}|${d.origen}`}>
                  <Td>{d.quien}</Td>
                  <Td>{textoOrigenDescuento(d.origen)}</Td>
                  <Td alinear="derecha">{d.piezas}</Td>
                </Fila>
              ))}
            </tbody>
          </Tabla>
        </CajaTabla>
      )}
    </Ventana>
  );
}
