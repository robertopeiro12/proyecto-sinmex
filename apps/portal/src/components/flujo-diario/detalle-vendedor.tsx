"use client";

import { Fragment, useState } from "react";
import { Etiqueta } from "@/components/ui/etiqueta";
import { Pestanas } from "@/components/ui/pestanas";
import { SelectorSegmentado } from "@/components/ui/selector-segmentado";
import { CajaTabla, FilaGrupo, FilaTotal, Tabla, Td, TdMonto, Th } from "@/components/ui/tabla";
import type { DetalleVendedorDia, NotaDetalle } from "@/lib/flujo-diario";
import { plural } from "@/lib/formato";
import { Barra, BotonFolio, FilaLineas, formatearPiezas, SinDatos, textoLineas, TituloBloque } from "./piezas";
import {
  PestanaCobranza,
  PestanaCorte,
  PestanaGastos,
  PestanaMermas,
  PestanaNotasCredito,
  PestanaVisitas,
} from "./detalle-vendedor-pestanas";

export type PestanaDetalleVendedor =
  | "venta"
  | "cobranza"
  | "gastos"
  | "notas"
  | "visitas"
  | "mermas"
  | "corte"
  | "inventario";

/**
 * El detalle de un vendedor en un día, abierto bajo su renglón (spec §5.2 y §5.3). Lo usan
 * el Flujo diario (`modo="flujo"`, sin Corte) y el Dashboard (`modo="dashboard"`).
 * `pestanaInicial`: picar un número del renglón abre su pestaña (Cobranza, Gastos…).
 * `onCambioPestana`: avisa la pestaña que eligió el usuario, para que el renglón la recuerde.
 */
export function DetalleVendedor({
  detalle,
  modo,
  pestanaInicial = "venta",
  onCambioPestana,
}: {
  detalle: DetalleVendedorDia;
  modo: "flujo" | "dashboard";
  pestanaInicial?: PestanaDetalleVendedor;
  onCambioPestana?: (pestana: PestanaDetalleVendedor) => void;
}) {
  const pestanas = [
    { valor: "venta", etiqueta: "Venta general", contenido: <PestanaVentaGeneral detalle={detalle} /> },
    { valor: "cobranza", etiqueta: "Cobranza", contenido: <PestanaCobranza detalle={detalle} /> },
    { valor: "gastos", etiqueta: "Gastos", contenido: <PestanaGastos gastos={detalle.gastos} /> },
    { valor: "notas", etiqueta: "Notas de venta", contenido: <PestanaNotasCredito notas={detalle.notasCredito} /> },
    { valor: "visitas", etiqueta: "Visitas", contenido: <PestanaVisitas visitas={detalle.visitas} /> },
    {
      valor: "mermas",
      etiqueta: "Mermas, cambios y promociones",
      contenido: <PestanaMermas promociones={detalle.promociones} />,
    },
    ...(modo === "dashboard"
      ? [{ valor: "corte", etiqueta: "Corte", contenido: <PestanaCorte corte={detalle.corte} /> }]
      : []),
    { valor: "inventario", etiqueta: "Inventario · pronto", contenido: null, deshabilitada: true },
  ];
  // Solo cuenta al montarse (Pestanas no es controlada): quien quiera mandar a otra pestaña
  // le cambia la `key`. Así recordar la que eligió el usuario no la vuelve a fijar.
  const [inicial] = useState(() => (pestanaInicial === "corte" && modo !== "dashboard" ? "venta" : pestanaInicial));
  return (
    <Pestanas
      etiqueta={`Detalle de ${detalle.vendedor}`}
      pestanas={pestanas}
      valorInicial={inicial}
      onCambio={(valor) => onCambioPestana?.(valor as PestanaDetalleVendedor)}
    />
  );
}

type Vista = "producto" | "cliente";

function PestanaVentaGeneral({ detalle }: { detalle: DetalleVendedorDia }) {
  const [vista, setVista] = useState<Vista>("producto");
  const piezas = detalle.porProducto.reduce((s, p) => s + p.piezas, 0);
  const clientes = new Set(detalle.notas.map((n) => n.cliente)).size;
  return (
    <div className="flex max-w-3xl flex-col gap-3.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SelectorSegmentado<Vista>
          etiqueta="Ver la venta"
          opciones={[
            { valor: "producto", texto: "Por producto" },
            { valor: "cliente", texto: "Por cliente" },
          ]}
          valor={vista}
          onCambio={setVista}
        />
        <p className="text-xs text-muted-foreground">
          {`${piezas === 1 ? "1 pieza" : `${formatearPiezas(piezas)} piezas`} · ${plural(detalle.notas.length, "nota", "notas")} · ${plural(clientes, "cliente", "clientes")}`}
        </p>
      </div>
      {vista === "producto" ? <PorProducto detalle={detalle} /> : <PorCliente notas={detalle.notas} />}
    </div>
  );
}

function PorProducto({ detalle }: { detalle: DetalleVendedorDia }) {
  if (detalle.porProducto.length === 0) return <SinDatos>Sin ventas este día.</SinDatos>;
  // Un grupo por presentación, el de más piezas primero; dentro, en el orden del servidor.
  const grupos = new Map<string, { producto: string; piezas: number }[]>();
  for (const p of detalle.porProducto) {
    const lista = grupos.get(p.presentacion) ?? [];
    lista.push(p);
    grupos.set(p.presentacion, lista);
  }
  const ordenados = [...grupos.entries()]
    .map(([presentacion, productos]) => ({
      presentacion,
      productos,
      total: productos.reduce((s, p) => s + p.piezas, 0),
    }))
    .sort((a, b) => b.total - a.total);
  const maximo = Math.max(...detalle.porProducto.map((p) => p.piezas));
  const total = ordenados.reduce((s, g) => s + g.total, 0);
  return (
    <div>
      <TituloBloque extra="agrupado por presentación">Por producto</TituloBloque>
      <CajaTabla>
        <Tabla densidad="compacta" aria-label="Por producto">
          <thead>
            <tr>
              <Th>Producto</Th>
              <Th className="w-[55%]">Piezas</Th>
              <Th alinear="derecha" className="w-24">
                <span className="sr-only">Cantidad</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {ordenados.map((g) => (
              <Fragment key={g.presentacion}>
                <FilaGrupo columnas={3}>
                  <span className="text-[12.5px]">{`${g.presentacion} · ${formatearPiezas(g.total)}`}</span>
                </FilaGrupo>
                {g.productos.map((p) => (
                  <tr key={p.producto}>
                    <Td>{p.producto}</Td>
                    <Td>
                      <Barra valor={p.piezas} maximo={maximo} />
                    </Td>
                    <Td alinear="derecha">{formatearPiezas(p.piezas)}</Td>
                  </tr>
                ))}
              </Fragment>
            ))}
            <FilaTotal>
              <Td>Total</Td>
              <Td />
              <Td alinear="derecha">{formatearPiezas(total)}</Td>
            </FilaTotal>
          </tbody>
        </Tabla>
      </CajaTabla>
    </div>
  );
}

function PorCliente({ notas }: { notas: NotaDetalle[] }) {
  const [abiertas, setAbiertas] = useState<Set<string>>(() => new Set());
  if (notas.length === 0) return <SinDatos>Sin ventas este día.</SinDatos>;
  const alternar = (folio: string) =>
    setAbiertas((antes) => {
      const nuevas = new Set(antes);
      if (nuevas.has(folio)) nuevas.delete(folio);
      else nuevas.add(folio);
      return nuevas;
    });
  return (
    <div>
      <TituloBloque extra="pica una nota para ver sus productos">Por cliente</TituloBloque>
      <CajaTabla>
        <Tabla densidad="compacta" aria-label="Por cliente">
          <thead>
            <tr>
              <Th>Cliente</Th>
              <Th>Folio</Th>
              <Th alinear="derecha">Piezas</Th>
              <Th alinear="derecha">Total</Th>
              <Th>
                <span className="sr-only">Contado o crédito</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {notas.map((n) => {
              const abierta = abiertas.has(n.folio);
              return (
                <Fragment key={n.folio}>
                  <tr className={abierta ? "bg-menu" : undefined}>
                    <Td>{n.cliente}</Td>
                    <Td className="whitespace-nowrap">
                      <BotonFolio folio={n.folio} abierta={abierta} onClick={() => alternar(n.folio)} />
                    </Td>
                    <Td alinear="derecha">{formatearPiezas(n.piezas)}</Td>
                    <TdMonto centavos={n.totalCentavos} />
                    <Td>
                      <Etiqueta tono={n.contadoCredito === "credito" ? "advertencia" : "exito"}>
                        {n.contadoCredito === "credito" ? "Crédito" : "Contado"}
                      </Etiqueta>
                    </Td>
                  </tr>
                  {abierta && <FilaLineas columnas={5} texto={textoLineas(n)} />}
                </Fragment>
              );
            })}
          </tbody>
        </Tabla>
      </CajaTabla>
    </div>
  );
}
