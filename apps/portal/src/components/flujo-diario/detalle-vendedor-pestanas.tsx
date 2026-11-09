"use client";

import { Fragment, useState } from "react";
import { Monto } from "@/components/ui/monto";
import { CajaTabla, FilaTotal, Tabla, Td, TdMonto, Th } from "@/components/ui/tabla";
import type { Corte, DetalleVendedorDia, PagoDetalle, VisitaDetalle } from "@/lib/flujo-diario";
import { formatearPesos, plural } from "@/lib/formato";
import {
  BotonFolio,
  EtiquetaVendio,
  FilaProductos,
  formatearPiezas,
  horaTijuana,
  SinDatos,
  sumar,
  TdImporte,
  TdLiquidada,
  RENGLON_QUE_ABRE,
  TituloBloque,
} from "./piezas";

/*
 * Las pestañas del detalle de un vendedor, salvo Venta general (en detalle-vendedor.tsx).
 */

/** Cobranza ventas de contado + ventas anteriores + Quedó a favor del cliente = la Cobranza del renglón (palabras del sistema viejo). */
export function PestanaCobranza({ detalle }: { detalle: DetalleVendedorDia }) {
  const { contado, anteriores, aFavor } = detalle.cobranza;
  const totalContado = sumar(contado, (p) => p.montoCentavos);
  const totalAnteriores = sumar(anteriores, (p) => p.montoCentavos);
  const totalAFavor = sumar(aFavor, (a) => a.montoCentavos);
  if (contado.length + anteriores.length + aFavor.length === 0) return <SinDatos>Sin cobranza este día.</SinDatos>;
  return (
    <div className="flex flex-col gap-4">
      <TituloBloque extra={<Monto centavos={totalContado + totalAnteriores + totalAFavor} />}>Cobranza</TituloBloque>
      {/* Una debajo de la otra, como el sistema viejo (Roberto, 2026-11-09). */}
      <div className="max-w-4xl">
        <TituloBloque tenue>{`Cobranza ventas de contado · ${formatearPesos(totalContado)}`}</TituloBloque>
        <TablaPagos titulo="Cobranza ventas de contado" pagos={contado} notas={detalle.notas} total={totalContado} />
      </div>
      <div className="max-w-4xl">
        <TituloBloque tenue>{`Cobranza ventas anteriores · ${formatearPesos(totalAnteriores)}`}</TituloBloque>
        <TablaPagos titulo="Cobranza ventas anteriores" pagos={anteriores} notas={detalle.notas} total={totalAnteriores} />
      </div>
      {aFavor.length > 0 && (
        <div className="max-w-4xl">
          <TituloBloque tenue>{`Quedó a favor del cliente · ${formatearPesos(totalAFavor)}`}</TituloBloque>
          <CajaTabla>
            <Tabla densidad="compacta" aria-label="Quedó a favor del cliente">
              <thead>
                <tr>
                  <Th>Cliente</Th>
                  <Th alinear="derecha">Importe</Th>
                </tr>
              </thead>
              <tbody>
                {aFavor.map((a, i) => (
                  <tr key={`${a.cliente}-${i}`}>
                    <Td>{a.cliente}</Td>
                    <TdMonto centavos={a.montoCentavos} />
                  </tr>
                ))}
              </tbody>
            </Tabla>
          </CajaTabla>
        </div>
      )}
    </div>
  );
}

/** Folio · Cliente · Importe · Liquidada. Un folio que es nota del día se abre a sus productos. */
function TablaPagos({
  titulo,
  pagos,
  notas,
  total,
}: {
  titulo: string;
  pagos: PagoDetalle[];
  notas: DetalleVendedorDia["notas"];
  total: number;
}) {
  const [abierta, setAbierta] = useState<number | null>(null);
  if (pagos.length === 0) return <SinDatos>Ninguna.</SinDatos>;
  return (
    <CajaTabla>
      {/* Mismos anchos en contado y anteriores: una debajo de la otra se leen como una lista. */}
      <Tabla densidad="compacta" aria-label={titulo} className="table-fixed">
        <colgroup>
          <col className="w-[10rem]" />
          <col />
          <col className="w-[8rem]" />
          <col className="w-[14rem]" />
        </colgroup>
        <thead>
          <tr>
            <Th>Folio</Th>
            <Th>Cliente</Th>
            <Th alinear="derecha">Importe</Th>
            <Th>Liquidada</Th>
          </tr>
        </thead>
        <tbody>
          {pagos.map((p, i) => {
            const nota = notas.find((n) => n.folio === p.folio);
            const estaAbierta = abierta === i;
            return (
              <Fragment key={`${p.folio}-${i}`}>
                <tr
                  className={nota ? `${RENGLON_QUE_ABRE} ${estaAbierta ? "bg-menu" : ""}` : undefined}
                  onClick={nota ? () => setAbierta(estaAbierta ? null : i) : undefined}
                >
                  <Td className="whitespace-nowrap">
                    {nota ? (
                      <BotonFolio folio={p.folio} abierta={estaAbierta} onClick={() => setAbierta(estaAbierta ? null : i)} />
                    ) : (
                      <span className="font-mono text-[12.5px]">{p.folio}</span>
                    )}
                  </Td>
                  <Td>{p.cliente}</Td>
                  <TdImporte pago={p} />
                  <TdLiquidada pago={p} />
                </tr>
                {estaAbierta && nota && <FilaProductos columnas={4} nota={nota} conPrecio />}
              </Fragment>
            );
          })}
          <FilaTotal>
            <Td colSpan={2}>Total</Td>
            <TdMonto centavos={total} />
            <Td />
          </FilaTotal>
        </tbody>
      </Tabla>
    </CajaTabla>
  );
}

export function PestanaGastos({ gastos }: { gastos: DetalleVendedorDia["gastos"] }) {
  if (gastos.length === 0) return <SinDatos>Sin gastos este día.</SinDatos>;
  return (
    <div className="max-w-xl">
      <CajaTabla>
        <Tabla densidad="compacta" aria-label="Gastos">
          <thead>
            <tr>
              <Th>Descripción</Th>
              <Th alinear="derecha">Gasto</Th>
            </tr>
          </thead>
          <tbody>
            {gastos.map((g, i) => (
              <tr key={`${g.descripcion}-${i}`}>
                <Td>{g.descripcion}</Td>
                <TdMonto centavos={g.montoCentavos} />
              </tr>
            ))}
            <FilaTotal>
              <Td>Total</Td>
              <TdMonto centavos={sumar(gastos, (g) => g.montoCentavos)} />
            </FilaTotal>
          </tbody>
        </Tabla>
      </CajaTabla>
    </div>
  );
}

/** Hoy, las notas nuevas a crédito del día (spec §6); las asignadas llegan con la pieza 6. */
/**
 * Las notas a crédito del día, con las palabras del sistema viejo: en el Dashboard son las
 * "pendientes nuevas por entregar" (la casilla Entregada llega con las notas asignadas,
 * pieza 6); en el Flujo diario, "pendientes nuevas".
 */
export function PestanaNotasCredito({
  notas,
  modo,
}: {
  notas: DetalleVendedorDia["notasCredito"];
  modo: "flujo" | "dashboard";
}) {
  if (notas.length === 0) return <SinDatos>No hay notas pendientes.</SinDatos>;
  const titulo = modo === "dashboard" ? "Notas pendientes nuevas por entregar" : "Notas pendientes nuevas";
  return (
    <div className="max-w-2xl">
      <TituloBloque extra={plural(notas.length, "nota", "notas")}>{titulo}</TituloBloque>
      <CajaTabla>
        <Tabla densidad="compacta" aria-label={titulo}>
          <thead>
            <tr>
              <Th>Cliente</Th>
              <Th>Folio</Th>
              <Th alinear="derecha">Monto</Th>
              <Th alinear="derecha">Pendiente</Th>
            </tr>
          </thead>
          <tbody>
            {notas.map((n) => (
              <tr key={n.folio}>
                <Td>{n.cliente}</Td>
                <Td className="font-mono text-[12.5px] whitespace-nowrap">{n.folio}</Td>
                <TdMonto centavos={n.totalCentavos} />
                <TdMonto centavos={n.pendienteCentavos} />
              </tr>
            ))}
          </tbody>
        </Tabla>
      </CajaTabla>
    </div>
  );
}

export function PestanaVisitas({ visitas }: { visitas: VisitaDetalle[] }) {
  if (visitas.length === 0) return <SinDatos>Sin visitas este día.</SinDatos>;
  const conVenta = visitas.filter((v) => v.vendio).length;
  return (
    <div>
      <TituloBloque extra={`${conVenta} con venta · ${visitas.length - conVenta} sin venta`}>Visitas</TituloBloque>
      <CajaTabla>
        <Tabla densidad="compacta" aria-label="Visitas">
          <thead>
            <tr>
              <Th>Cliente</Th>
              <Th>Vendió</Th>
              <Th>Hora</Th>
              <Th>Motivo</Th>
              <Th>Atendió</Th>
              <Th>Comentario</Th>
            </tr>
          </thead>
          <tbody>
            {visitas.map((v, i) => (
              <tr key={`${v.cliente}-${i}`}>
                <Td>{v.cliente}</Td>
                <Td>
                  <EtiquetaVendio vendio={v.vendio} />
                </Td>
                <Td className="whitespace-nowrap">{horaTijuana(v.hora)}</Td>
                <Td>{v.motivo ?? ""}</Td>
                <Td>{v.atendio ?? ""}</Td>
                <Td>{v.comentario ?? ""}</Td>
              </tr>
            ))}
          </tbody>
        </Tabla>
      </CajaTabla>
    </div>
  );
}

/** Hoy solo hay promociones (las mermas y cambios no existen en la base): un bloque por cliente, como el viejo. */
export function PestanaMermas({ promociones }: { promociones: DetalleVendedorDia["promociones"] }) {
  if (promociones.length === 0) return <SinDatos>Sin promociones este día.</SinDatos>;
  const porCliente = new Map<string, { producto: string; cantidad: number }[]>();
  for (const p of promociones) {
    const lista = porCliente.get(p.cliente) ?? [];
    lista.push(p);
    porCliente.set(p.cliente, lista);
  }
  return (
    <div className="flex max-w-xl flex-col gap-2">
      {[...porCliente.entries()].map(([cliente, productos]) => (
        <section key={cliente} className="flex flex-col gap-2">
          <h3 className="rounded-lg bg-menu px-3 py-2 text-[13.5px] font-semibold">{cliente}</h3>
          <TituloBloque tenue>Promociones</TituloBloque>
          <CajaTabla>
            <Tabla densidad="compacta" aria-label={`Promociones de ${cliente}`}>
              <thead>
                <tr>
                  <Th>Producto</Th>
                  <Th alinear="derecha">Cantidad</Th>
                </tr>
              </thead>
              <tbody>
                {productos.map((p, i) => (
                  <tr key={`${p.producto}-${i}`}>
                    <Td>{p.producto}</Td>
                    <Td alinear="derecha">{formatearPiezas(p.cantidad)}</Td>
                  </tr>
                ))}
                <FilaTotal>
                  <Td>Total</Td>
                  <Td alinear="derecha">{formatearPiezas(productos.reduce((s, p) => s + p.cantidad, 0))}</Td>
                </FilaTotal>
              </tbody>
            </Tabla>
          </CajaTabla>
        </section>
      ))}
    </div>
  );
}

/** Solo en el Dashboard: Ventas contado + Ventas anteriores (+ a favor) − Gasto = Tesorería (palabras del viejo). */
export function PestanaCorte({ corte }: { corte: Corte | null }) {
  if (!corte) return <SinDatos>El vendedor no ha terminado su ruta.</SinDatos>;
  const renglon = (texto: string, valor: string) => (
    <tr>
      <Td className="text-sm">{texto}</Td>
      <Td alinear="derecha" className="text-sm whitespace-nowrap">
        {valor}
      </Td>
    </tr>
  );
  return (
    <div className="max-w-md">
      <TituloBloque extra="terminó su ruta">Corte</TituloBloque>
      <CajaTabla>
        <Tabla aria-label="Corte">
          <tbody>
            {renglon("Ventas contado", formatearPesos(corte.contadoCentavos))}
            {renglon("Ventas anteriores", formatearPesos(corte.anterioresCentavos))}
            {corte.aFavorCentavos > 0 && renglon("Quedó a favor del cliente", formatearPesos(corte.aFavorCentavos))}
            {renglon("Gasto", `− ${formatearPesos(corte.gastoCentavos)}`)}
            <FilaTotal className="[&>td]:border-foreground">
              <Td className="text-[15px]">Tesorería</Td>
              <TdMonto centavos={corte.tesoreriaCentavos} className="text-[15px]" />
            </FilaTotal>
          </tbody>
        </Tabla>
      </CajaTabla>
    </div>
  );
}
