"use client";

import { Fragment, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { Aviso } from "@/components/ui/aviso";
import { Button } from "@/components/ui/button";
import { Casilla } from "@/components/ui/campo";
import { Fecha } from "@/components/ui/fecha";
import { Monto } from "@/components/ui/monto";
import { CajaTabla, FilaTotal, Tabla, Td, TdMonto, Th } from "@/components/ui/tabla";
import { mensajeDe } from "@/lib/api";
import {
  guardarNotasEntregadas,
  type Corte,
  type DetalleVendedorDia,
  type PagoDetalle,
  type VisitaDetalle,
} from "@/lib/flujo-diario";
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

/**
 * Las notas a crédito del día, con las palabras del sistema viejo. En el Dashboard son las
 * "pendientes nuevas por entregar", con la casilla Entregada (¿el vendedor regresó la nota de
 * papel?) y "Guardar revisión"; debajo, las nuevas NO entregadas de días anteriores. En el
 * Flujo diario, solo consulta: entregadas y NO entregadas (sin revisar cuenta como no).
 * Las notas asignadas llegan con la pieza 6.
 */
export function PestanaNotasCredito({
  detalle,
  modo,
  onGuardadas,
}: {
  detalle: DetalleVendedorDia;
  modo: "flujo" | "dashboard";
  onGuardadas?: () => void;
}) {
  if (modo === "dashboard") return <NotasDashboard detalle={detalle} onGuardadas={onGuardadas} />;
  const entregadas = detalle.notasCredito.filter((n) => n.entregada === true);
  const noEntregadas = detalle.notasCredito.filter((n) => n.entregada !== true);
  if (detalle.notasCredito.length === 0) return <SinDatos>No hay notas pendientes.</SinDatos>;
  return (
    <div className="flex max-w-2xl flex-col gap-5">
      {entregadas.length > 0 && <TablaNotas titulo="Notas pendientes nuevas entregadas" notas={entregadas} />}
      {noEntregadas.length > 0 && <TablaNotas titulo="Notas nuevas NO entregadas" notas={noEntregadas} />}
    </div>
  );
}

function TablaNotas({ titulo, notas }: { titulo: string; notas: DetalleVendedorDia["notasCredito"] }) {
  return (
    <div>
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

const TITULO_POR_ENTREGAR = "Notas pendientes nuevas por entregar";
const TITULO_NO_ENTREGADAS = "Notas nuevas NO entregadas";

function NotasDashboard({ detalle, onGuardadas }: { detalle: DetalleVendedorDia; onGuardadas?: () => void }) {
  const { puede } = useAuth();
  const puedeRevisar = puede("nota_papel.revisar");
  // Lo que el usuario cambió y aún no llega del servidor: sobrevive a la actualización
  // automática del Dashboard (cada 60 s), que trae otra vez el detalle.
  const [marcas, setMarcas] = useState<ReadonlyMap<string, boolean>>(() => new Map());
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { notasCredito: notas, notasNoEntregadas } = detalle;

  if (notas.length === 0 && notasNoEntregadas.length === 0) return <SinDatos>No hay notas pendientes.</SinDatos>;

  const marcada = (n: (typeof notas)[number]) => marcas.get(n.folio) ?? n.entregada === true;

  function marcar(folio: string, valor: boolean) {
    setMarcas((antes) => new Map(antes).set(folio, valor));
  }

  async function guardar() {
    setGuardando(true);
    setError(null);
    try {
      // Guardar es la revisión completa: la que queda sin marcar es "no entregada".
      await guardarNotasEntregadas({
        vendedor: detalle.vendedorId,
        notas: notas.map((n) => ({ folio: n.folio, entregada: marcada(n) })),
      });
      onGuardadas?.();
    } catch (err) {
      setError(mensajeDe(err, "No se pudo guardar la revisión."));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="flex max-w-2xl flex-col gap-5">
      {notas.length > 0 && (
        <div>
          <TituloBloque extra={plural(notas.length, "nota", "notas")}>{TITULO_POR_ENTREGAR}</TituloBloque>
          <CajaTabla>
            <Tabla densidad="compacta" aria-label={TITULO_POR_ENTREGAR}>
              <thead>
                <tr>
                  <Th>Cliente</Th>
                  <Th>Folio</Th>
                  <Th alinear="derecha">Monto</Th>
                  <Th alinear="derecha">Pendiente</Th>
                  <Th alinear="centro">Entregada</Th>
                </tr>
              </thead>
              <tbody>
                {notas.map((n) => (
                  <tr key={n.folio}>
                    <Td>{n.cliente}</Td>
                    <Td className="font-mono text-[12.5px] whitespace-nowrap">{n.folio}</Td>
                    <TdMonto centavos={n.totalCentavos} />
                    <TdMonto centavos={n.pendienteCentavos} />
                    <Td alinear="centro">
                      <Casilla
                        aria-label={`Entregada ${n.folio}`}
                        checked={marcada(n)}
                        disabled={!puedeRevisar || guardando}
                        onChange={(e) => marcar(n.folio, e.target.checked)}
                      />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Tabla>
          </CajaTabla>
          {error && (
            <Aviso tono="error" className="mt-2.5">
              {error}
            </Aviso>
          )}
          {puedeRevisar && (
            <div className="mt-2.5 flex justify-end">
              <Button onClick={() => void guardar()} disabled={guardando}>
                {guardando ? "Guardando…" : "Guardar revisión"}
              </Button>
            </div>
          )}
        </div>
      )}
      {notasNoEntregadas.length > 0 && (
        <div>
          <TituloBloque extra={plural(notasNoEntregadas.length, "nota", "notas")}>{TITULO_NO_ENTREGADAS}</TituloBloque>
          <CajaTabla>
            <Tabla densidad="compacta" aria-label={TITULO_NO_ENTREGADAS}>
              <thead>
                <tr>
                  <Th>Cliente</Th>
                  <Th>Folio</Th>
                  <Th>Fecha</Th>
                  <Th alinear="derecha">Monto</Th>
                  <Th alinear="derecha">Pendiente</Th>
                </tr>
              </thead>
              <tbody>
                {notasNoEntregadas.map((n) => (
                  <tr key={n.folio}>
                    <Td>{n.cliente}</Td>
                    <Td className="font-mono text-[12.5px] whitespace-nowrap">{n.folio}</Td>
                    <Td>
                      <Fecha valor={n.fecha} />
                    </Td>
                    <TdMonto centavos={n.totalCentavos} />
                    <TdMonto centavos={n.pendienteCentavos} />
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
