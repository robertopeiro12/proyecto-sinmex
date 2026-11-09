"use client";

import { useState } from "react";
import { Etiqueta } from "@/components/ui/etiqueta";
import { Monto } from "@/components/ui/monto";
import { Pestanas } from "@/components/ui/pestanas";
import { SelectorSegmentado } from "@/components/ui/selector-segmentado";
import { CajaTabla, FilaTotal, Tabla, Td, TdMonto, Th } from "@/components/ui/tabla";
import type { DetalleDia as DatosDetalleDia } from "@/lib/flujo-diario";
import { formatearPesos } from "@/lib/formato";
import {
  Barra,
  EtiquetaVendio,
  formatearPiezas,
  horaTijuana,
  SinDatos,
  sumar,
  TdImporte,
  TdLiquidada,
  TituloBloque,
} from "./piezas";

export type PestanaDetalleDia = "ventas" | "cobranza" | "gastos" | "mermas" | "promociones" | "visitas";

/** El nombre de cada pestaña: lo usan las pestañas y el título de la ventana. */
export const ETIQUETA_PESTANA_DIA: Record<PestanaDetalleDia, string> = {
  ventas: "Ventas",
  cobranza: "Cobranza",
  gastos: "Gastos",
  mermas: "Mermas",
  promociones: "Promociones",
  visitas: "Visitas",
};

const E = ETIQUETA_PESTANA_DIA;

/**
 * El detalle de un día de una sucursal en "Por día" (spec §5.3). La cobranza incluye la
 * de la oficina ("Oficina"); las mermas todavía no existen en la base (spec §6).
 */
export function DetalleDia({
  detalle,
  pestanaInicial = "ventas",
  onCambioPestana,
}: {
  detalle: DatosDetalleDia;
  pestanaInicial?: PestanaDetalleDia;
  /** Avisa la pestaña que eligió el usuario, para que el título de la ventana la siga. */
  onCambioPestana?: (pestana: PestanaDetalleDia) => void;
}) {
  // Solo cuenta al montarse (Pestanas no es controlada); para mandar a otra pestaña se cambia la `key`.
  const [inicial] = useState(pestanaInicial);
  return (
    <Pestanas
      etiqueta="Detalle del día"
      valorInicial={inicial}
      onCambio={(valor) => onCambioPestana?.(valor as PestanaDetalleDia)}
      pestanas={[
        { valor: "ventas", etiqueta: E.ventas, contenido: <PestanaVentas detalle={detalle} /> },
        { valor: "cobranza", etiqueta: E.cobranza, contenido: <PestanaCobranzaDia detalle={detalle} /> },
        { valor: "gastos", etiqueta: E.gastos, contenido: <PestanaGastosDia gastos={detalle.gastos} /> },
        {
          valor: "mermas",
          etiqueta: E.mermas,
          contenido: <SinDatos>Todavía no se registran mermas en el sistema.</SinDatos>,
        },
        { valor: "promociones", etiqueta: E.promociones, contenido: <PestanaPromocionesDia detalle={detalle} /> },
        { valor: "visitas", etiqueta: E.visitas, contenido: <PestanaVisitasDia visitas={detalle.visitas} /> },
      ]}
    />
  );
}

type Vista = "presentacion" | "producto" | "vendedor" | "cliente";

function PestanaVentas({ detalle }: { detalle: DatosDetalleDia }) {
  const [vista, setVista] = useState<Vista>("presentacion");
  return (
    <div className="flex max-w-3xl flex-col gap-3.5">
      <div>
        <SelectorSegmentado<Vista>
          etiqueta="Ver las ventas"
          opciones={[
            { valor: "presentacion", texto: "Por presentación" },
            { valor: "producto", texto: "Por producto" },
            { valor: "vendedor", texto: "Por vendedor" },
            { valor: "cliente", texto: "Por cliente" },
          ]}
          valor={vista}
          onCambio={setVista}
        />
      </div>
      {vista === "presentacion" && (
        <TablaConBarra
          titulo="Presentación"
          filas={detalle.porPresentacion.map((p) => ({ nombre: p.presentacion, piezas: p.piezas }))}
        />
      )}
      {vista === "producto" && (
        <TablaConBarra titulo="Producto" filas={detalle.porProducto.map((p) => ({ nombre: p.producto, piezas: p.piezas }))} />
      )}
      {vista === "vendedor" && (
        <TablaPorQuien titulo="Vendedor" filas={detalle.porVendedor.map((f) => ({ quien: f.vendedor, ...f }))} />
      )}
      {vista === "cliente" && (
        <TablaPorQuien titulo="Cliente" filas={detalle.porCliente.map((f) => ({ quien: f.cliente, ...f }))} />
      )}
    </div>
  );
}

function TablaConBarra({ titulo, filas }: { titulo: string; filas: { nombre: string; piezas: number }[] }) {
  if (filas.length === 0) return <SinDatos>Sin ventas este día.</SinDatos>;
  const maximo = Math.max(...filas.map((f) => f.piezas));
  return (
    <CajaTabla>
      <Tabla densidad="compacta" aria-label={`Ventas por ${titulo.toLowerCase()}`}>
        <thead>
          <tr>
            <Th>{titulo}</Th>
            <Th className="w-[55%]">Piezas</Th>
            <Th alinear="derecha" className="w-24">
              <span className="sr-only">Cantidad</span>
            </Th>
          </tr>
        </thead>
        <tbody>
          {filas.map((f) => (
            <tr key={f.nombre}>
              <Td>{f.nombre}</Td>
              <Td>
                <Barra valor={f.piezas} maximo={maximo} />
              </Td>
              <Td alinear="derecha">{formatearPiezas(f.piezas)}</Td>
            </tr>
          ))}
          <FilaTotal>
            <Td>Total</Td>
            <Td />
            <Td alinear="derecha">{formatearPiezas(sumar(filas, (f) => f.piezas))}</Td>
          </FilaTotal>
        </tbody>
      </Tabla>
    </CajaTabla>
  );
}

function TablaPorQuien({
  titulo,
  filas,
}: {
  titulo: string;
  filas: { quien: string; presentacion: string; piezas: number }[];
}) {
  if (filas.length === 0) return <SinDatos>Sin ventas este día.</SinDatos>;
  return (
    <CajaTabla>
      <Tabla densidad="compacta" aria-label={`Ventas por ${titulo.toLowerCase()}`}>
        <thead>
          <tr>
            <Th>{titulo}</Th>
            <Th>Presentación</Th>
            <Th alinear="derecha">Piezas</Th>
          </tr>
        </thead>
        <tbody>
          {filas.map((f, i) => (
            <tr key={`${f.quien}-${f.presentacion}-${i}`}>
              <Td>{f.quien}</Td>
              <Td>{f.presentacion}</Td>
              <Td alinear="derecha">{formatearPiezas(f.piezas)}</Td>
            </tr>
          ))}
          <FilaTotal>
            <Td colSpan={2}>Total</Td>
            <Td alinear="derecha">{formatearPiezas(sumar(filas, (f) => f.piezas))}</Td>
          </FilaTotal>
        </tbody>
      </Tabla>
    </CajaTabla>
  );
}

function Cobrador({ nombre }: { nombre: string | null }) {
  return nombre ?? <Etiqueta tono="neutro">Oficina</Etiqueta>;
}

function PestanaCobranzaDia({ detalle }: { detalle: DatosDetalleDia }) {
  const { cobranza, aFavor } = detalle;
  if (cobranza.length + aFavor.length === 0) return <SinDatos>Sin cobranza este día.</SinDatos>;
  const totalAFavor = sumar(aFavor, (a) => a.montoCentavos);
  const total = sumar(cobranza, (p) => p.montoCentavos) + totalAFavor;
  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <TituloBloque extra={<>incluye a la oficina · <Monto centavos={total} /></>}>Cobranza</TituloBloque>
      {cobranza.length > 0 && (
        <CajaTabla>
          <Tabla densidad="compacta" aria-label="Cobranza del día">
            <thead>
              <tr>
                <Th>Cobrador</Th>
                <Th>Cliente</Th>
                <Th>Folio</Th>
                <Th alinear="derecha">Importe</Th>
                <Th>Liquidada</Th>
              </tr>
            </thead>
            <tbody>
              {cobranza.map((p, i) => (
                <tr key={`${p.folio}-${i}`}>
                  <Td>
                    <Cobrador nombre={p.cobrador} />
                  </Td>
                  <Td>{p.cliente}</Td>
                  <Td className="font-mono text-[12.5px] whitespace-nowrap">{p.folio}</Td>
                  <TdImporte pago={p} />
                  <TdLiquidada pago={p} />
                </tr>
              ))}
            </tbody>
          </Tabla>
        </CajaTabla>
      )}
      {aFavor.length > 0 && (
        <div className="max-w-xl">
          <TituloBloque tenue>{`Quedó a favor del cliente · ${formatearPesos(totalAFavor)}`}</TituloBloque>
          <CajaTabla>
            <Tabla densidad="compacta" aria-label="Quedó a favor del cliente">
              <thead>
                <tr>
                  <Th>Cobrador</Th>
                  <Th>Cliente</Th>
                  <Th alinear="derecha">Importe</Th>
                </tr>
              </thead>
              <tbody>
                {aFavor.map((a, i) => (
                  <tr key={`${a.cliente}-${i}`}>
                    <Td>
                      <Cobrador nombre={a.cobrador} />
                    </Td>
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

function PestanaGastosDia({ gastos }: { gastos: DatosDetalleDia["gastos"] }) {
  if (gastos.length === 0) return <SinDatos>Sin gastos este día.</SinDatos>;
  return (
    <div className="max-w-2xl">
      <CajaTabla>
        <Tabla densidad="compacta" aria-label="Gastos del día">
          <thead>
            <tr>
              <Th>Vendedor</Th>
              <Th>Descripción</Th>
              <Th alinear="derecha">Gasto</Th>
            </tr>
          </thead>
          <tbody>
            {gastos.map((g, i) => (
              <tr key={`${g.vendedor}-${i}`}>
                <Td>{g.vendedor}</Td>
                <Td>{g.descripcion}</Td>
                <TdMonto centavos={g.montoCentavos} />
              </tr>
            ))}
            <FilaTotal>
              <Td colSpan={2}>Total</Td>
              <TdMonto centavos={sumar(gastos, (g) => g.montoCentavos)} />
            </FilaTotal>
          </tbody>
        </Tabla>
      </CajaTabla>
    </div>
  );
}

function PestanaPromocionesDia({ detalle }: { detalle: DatosDetalleDia }) {
  if (detalle.promociones.length === 0) return <SinDatos>Sin promociones este día.</SinDatos>;
  return (
    <div className="max-w-xl">
      <CajaTabla>
        <Tabla densidad="compacta" aria-label="Promociones del día">
          <thead>
            <tr>
              <Th>Producto</Th>
              <Th alinear="derecha">Cantidad</Th>
            </tr>
          </thead>
          <tbody>
            {detalle.promociones.map((p) => (
              <tr key={p.producto}>
                <Td>{p.producto}</Td>
                <Td alinear="derecha">{formatearPiezas(p.cantidad)}</Td>
              </tr>
            ))}
          </tbody>
        </Tabla>
      </CajaTabla>
    </div>
  );
}

function PestanaVisitasDia({ visitas }: { visitas: DatosDetalleDia["visitas"] }) {
  if (visitas.length === 0) return <SinDatos>Sin visitas este día.</SinDatos>;
  return (
    <CajaTabla>
      <Tabla densidad="compacta" aria-label="Visitas del día">
        <thead>
          <tr>
            <Th>Vendedor</Th>
            <Th>Cliente</Th>
            <Th>Vendió</Th>
            <Th>Hora</Th>
            <Th>Motivo</Th>
            <Th>Comentario</Th>
          </tr>
        </thead>
        <tbody>
          {visitas.map((v, i) => (
            <tr key={`${v.vendedor}-${v.cliente}-${i}`}>
              <Td>{v.vendedor}</Td>
              <Td>{v.cliente}</Td>
              <Td>
                <EtiquetaVendio vendio={v.vendio} />
              </Td>
              <Td className="whitespace-nowrap">{horaTijuana(v.hora)}</Td>
              <Td>{v.motivo ?? ""}</Td>
              <Td>{v.comentario ?? ""}</Td>
            </tr>
          ))}
        </tbody>
      </Tabla>
    </CajaTabla>
  );
}
