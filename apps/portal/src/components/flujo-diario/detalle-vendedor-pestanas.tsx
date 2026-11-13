"use client";

import { Fragment, useEffect, useState, type ReactNode } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { Aviso } from "@/components/ui/aviso";
import { Button } from "@/components/ui/button";
import { Casilla } from "@/components/ui/campo";
import { Fecha } from "@/components/ui/fecha";
import { Monto } from "@/components/ui/monto";
import { CajaTabla, FilaTotal, Tabla, Td, TdMonto, Th } from "@/components/ui/tabla";
import { mensajeDe } from "@/lib/api";
import {
  fechaRevisable,
  guardarNotasEntregadas,
  type Corte,
  type DetalleVendedorDia,
  type NotaNoEntregada,
  type NotaRevision,
  type PagoDetalle,
  type VisitaDetalle,
} from "@/lib/flujo-diario";
import { formatearPesos, plural } from "@/lib/formato";
import { Etiqueta } from "@/components/ui/etiqueta";
import type { CondicionVenta } from "@/lib/rutas";
import { hoyEnTijuana } from "@/lib/ventas";
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
      <div className="mx-auto w-full max-w-5xl">
        <TituloBloque tenue>Cobranza ventas de contado</TituloBloque>
        <TablaPagos titulo="Cobranza ventas de contado" pagos={contado} notas={detalle.notas} total={totalContado} />
      </div>
      <div className="mx-auto w-full max-w-5xl">
        <TituloBloque tenue>Cobranza ventas anteriores</TituloBloque>
        <TablaPagos titulo="Cobranza ventas anteriores" pagos={anteriores} notas={detalle.notas} total={totalAnteriores} />
      </div>
      {aFavor.length > 0 && (
        <div className="mx-auto w-full max-w-5xl">
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
    <div className="mx-auto w-full max-w-xl">
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
 * "Notas de ventas": la revisión de papel de la tarde (spec Ruta Diaria parte 2, §2), igual en el
 * Dashboard y en el Flujo diario. Tres listas con las palabras del tío: las asignadas que ya se
 * cobraron (solo se ven, salvo las que ya se habían revisado: esas conservan su casilla), las asignadas que todavía deben y las ventas a crédito nuevas, estas dos con
 * la casilla Entregada (¿regresó el papel?). Sin revisar = palomeada: Administración solo le quita la
 * palomita a lo que no le dieron. "Guardar revisión" manda las dos listas completas con la fecha del
 * detalle; "Cancelar" regresa a lo guardado (el CANCELAR / GUARDAR del viejo). Se puede guardar con
 * `nota_papel.revisar` y si el día es hoy o ayer de Tijuana; si no, solo consulta. Debajo, "Notas de
 * Ventas NO Entregadas": lo guardado en no y las de días anteriores que siguen sin llegar.
 */
export function PestanaNotas({
  detalle,
  onGuardadas,
  onCambiosPendientes,
}: {
  detalle: DetalleVendedorDia;
  /** Se guardó la revisión; `noEntregadas` = cuántas quedaron en no (el número del renglón). */
  onGuardadas?: (noEntregadas: number) => void;
  /** Hay casillas cambiadas a mano sin guardar (para preguntar antes de cerrar). */
  onCambiosPendientes?: (hay: boolean) => void;
}) {
  const { puede } = useAuth();
  const editable = puede("nota_papel.revisar") && fechaRevisable(detalle.fecha, hoyEnTijuana());
  // Lo que el usuario cambió y aún no guarda, por venta: sobrevive a la actualización automática del
  // Dashboard (cada 60 s), que trae otra vez el detalle. Al guardar bien se olvida.
  const [marcas, setMarcas] = useState<ReadonlyMap<string, boolean>>(() => new Map());
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { asignadasCobradas, asignadasPorEntregar, notasCredito, notasNoEntregadas } = detalle;
  // Una asignada que se guardó y después se pagó se queda en "Cobradas" con su `entregada` (el
  // servidor la sigue contando en el renglón): lleva casilla para corregirla. Las que nunca se
  // revisaron ahí solo se ven.
  const cobradasRevisadas = asignadasCobradas.filter((n) => n.entregada !== null);
  const asignadasConCasilla = [...asignadasPorEntregar, ...cobradasRevisadas];
  const conCasilla = [...asignadasConCasilla, ...notasCredito];
  const palomeadaDeInicio = (n: NotaRevision) => n.entregada !== false;
  const marcada = (n: NotaRevision) => marcas.get(n.ventaNotaId) ?? palomeadaDeInicio(n);
  // Cambios hechos a mano: Cancelar y la pregunta al cerrar. Una sin revisar también se guarda
  // (todo llegó), así que Guardar se activa con cualquier nota cuyo valor guardado no sea el de pantalla.
  const tocadas = conCasilla.some((n) => marcada(n) !== palomeadaDeInicio(n));
  const porGuardar = conCasilla.some((n) => marcada(n) !== n.entregada);

  useEffect(() => {
    onCambiosPendientes?.(tocadas);
  }, [tocadas, onCambiosPendientes]);
  useEffect(() => () => onCambiosPendientes?.(false), [onCambiosPendientes]);

  const noEntregadas: (NotaNoEntregada & { clave: string })[] = [
    ...conCasilla
      .filter((n) => n.entregada === false)
      .map((n) => ({ ...n, fecha: detalle.fecha, clave: n.ventaNotaId })),
    ...notasNoEntregadas.map((n) => ({ ...n, clave: `${n.fecha}|${n.folio}` })),
  ];

  if (conCasilla.length + asignadasCobradas.length + notasNoEntregadas.length === 0)
    return <SinDatos>No hay notas pendientes.</SinDatos>;

  function marcar(ventaNotaId: string, valor: boolean) {
    setMarcas((antes) => new Map(antes).set(ventaNotaId, valor));
  }

  async function guardar() {
    setGuardando(true);
    setError(null);
    try {
      // Guardar es la revisión completa de las dos listas: la que queda sin palomita es "no entregada".
      await guardarNotasEntregadas({
        vendedor: detalle.vendedorId,
        fecha: detalle.fecha,
        notas: notasCredito.map((n) => ({ folio: n.folio, entregada: marcada(n) })),
        asignadas: asignadasConCasilla.map((n) => ({ ventaNotaId: n.ventaNotaId, entregada: marcada(n) })),
      });
      const cuantas = conCasilla.filter((n) => !marcada(n)).length;
      setMarcas(new Map());
      onGuardadas?.(cuantas);
    } catch (err) {
      setError(mensajeDe(err, "No se pudo guardar la revisión."));
    } finally {
      setGuardando(false);
    }
  }

  const casilla = editable
    ? (n: NotaRevision) => (
        <Casilla
          aria-label={`Entregada ${n.folio}`}
          checked={marcada(n)}
          disabled={guardando}
          onChange={(e) => marcar(n.ventaNotaId, e.target.checked)}
        />
      )
    : (n: NotaRevision) =>
        n.entregada === null ? (
          <span className="text-muted-foreground">Sin revisar</span>
        ) : n.entregada ? (
          "Sí"
        ) : (
          <span className="font-semibold text-destructive">No</span>
        );

  return (
    <div className="flex mx-auto w-full max-w-5xl flex-col gap-5">
      {asignadasCobradas.length > 0 && (
        <TablaRevision
          titulo={TITULO_ASIGNADAS_COBRADAS}
          notas={asignadasCobradas}
          entregada={(n) => (n.entregada === null ? <span className="text-muted-foreground">—</span> : casilla(n))}
        />
      )}
      {asignadasPorEntregar.length > 0 && (
        <TablaRevision titulo={TITULO_ASIGNADAS_POR_ENTREGAR} notas={asignadasPorEntregar} entregada={casilla} />
      )}
      {notasCredito.length > 0 && <TablaRevision titulo={TITULO_NUEVAS} notas={notasCredito} entregada={casilla} />}
      {editable && conCasilla.length > 0 && (
        <div className="flex flex-col gap-2.5">
          {error && <Aviso tono="error">{error}</Aviso>}
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setMarcas(new Map());
                setError(null);
              }}
              disabled={guardando || !tocadas}
            >
              Cancelar
            </Button>
            <Button onClick={() => void guardar()} disabled={guardando || !porGuardar}>
              {guardando ? "Guardando…" : "Guardar revisión"}
            </Button>
          </div>
        </div>
      )}
      {noEntregadas.length > 0 && (
        <div>
          <TituloBloque extra={plural(noEntregadas.length, "nota", "notas")}>{TITULO_NO_ENTREGADAS}</TituloBloque>
          <CajaTabla>
            <Tabla densidad="compacta" aria-label={TITULO_NO_ENTREGADAS} className="table-fixed">
              <ColumnasRevision />
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
                {noEntregadas.map((n) => (
                  <tr key={n.clave}>
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

const TITULO_ASIGNADAS_COBRADAS = "Notas Asignadas Cobradas";
const TITULO_ASIGNADAS_POR_ENTREGAR = "Notas Asignadas NO cobradas por Entregar";
const TITULO_NUEVAS = "Notas Nuevas x Cobrar Entregadas";
const TITULO_NO_ENTREGADAS = "Notas de Ventas NO Entregadas";

/** Etiqueta corta de la condición de venta (los textos largos del selector viven en `lib/rutas`). */
const ETIQUETA_CONDICION: Record<Exclude<CondicionVenta, "ninguna">, string> = {
  liquidar: "Solo si liquida",
  abonar: "Solo si abona",
};

/** Los mismos anchos en las cuatro tablas: una debajo de la otra se leen como una sola lista. */
function ColumnasRevision() {
  return (
    <colgroup>
      <col />
      <col className="w-[10rem]" />
      <col className="w-[8rem]" />
      <col className="w-[8rem]" />
      <col className="w-[8rem]" />
    </colgroup>
  );
}

/** Cliente · Folio · Monto · Pendiente · Entregada (`entregada` dice cómo pintar esa celda). */
function TablaRevision({
  titulo,
  notas,
  entregada,
}: {
  titulo: string;
  notas: NotaRevision[];
  entregada: (n: NotaRevision) => ReactNode;
}) {
  return (
    <div>
      <TituloBloque extra={plural(notas.length, "nota", "notas")}>{titulo}</TituloBloque>
      <CajaTabla>
        <Tabla densidad="compacta" aria-label={titulo} className="table-fixed">
          <ColumnasRevision />
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
              <tr key={n.ventaNotaId}>
                <Td>
                  {n.cliente}
                  {n.comentarioVendedor && (
                    <div
                      className="line-clamp-2 text-xs text-muted-foreground"
                      title={`${n.comentarioVendedor.vendedor}: ${n.comentarioVendedor.texto}`}
                    >
                      {n.comentarioVendedor.vendedor}: {n.comentarioVendedor.texto}
                    </div>
                  )}
                </Td>
                <Td className="font-mono text-[12.5px] whitespace-nowrap">
                  {n.folio}
                  {n.condicionVenta && n.condicionVenta !== "ninguna" && (
                    <div className="mt-0.5 font-sans">
                      <Etiqueta tono="advertencia">{ETIQUETA_CONDICION[n.condicionVenta]}</Etiqueta>
                    </div>
                  )}
                </Td>
                <TdMonto centavos={n.totalCentavos} />
                <TdMonto centavos={n.pendienteCentavos} />
                <Td alinear="centro">{entregada(n)}</Td>
              </tr>
            ))}
          </tbody>
        </Tabla>
      </CajaTabla>
    </div>
  );
}

/**
 * La pestaña "Ruta" (la ventana "Visitas" del sistema viejo, que se abre al picar Ruta): los
 * clientes de su ruta en su orden, con "Cliente no visitado" en los que faltaron, y después los
 * que atendió fuera de ruta.
 */
export function PestanaVisitas({ visitas }: { visitas: VisitaDetalle[] }) {
  if (visitas.length === 0) return <SinDatos>Sin ruta ni visitas este día.</SinDatos>;
  // Por cliente, no por renglón (un cliente con venta y visita sale dos veces): cuadra con el x / y.
  const clientes = (cumple: (v: VisitaDetalle) => boolean) => new Set(visitas.filter(cumple).map((v) => v.cliente)).size;
  const visitados = clientes((v) => v.visitado);
  const conVenta = clientes((v) => v.vendio);
  const noVisitados = clientes((v) => !v.visitado);
  return (
    <div>
      <TituloBloque
        extra={`${plural(visitados, "cliente visitado", "clientes visitados")} · ${conVenta} con venta · ${plural(noVisitados, "no visitado", "no visitados")}`}
      >
        Ruta
      </TituloBloque>
      <CajaTabla>
        <Tabla densidad="compacta" aria-label="Ruta">
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
                <Td className={`whitespace-nowrap ${v.visitado ? "" : "text-muted-foreground"}`}>
                  {v.visitado ? horaTijuana(v.hora) : "Cliente no visitado"}
                </Td>
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
    <div className="flex mx-auto w-full max-w-xl flex-col gap-2">
      {[...porCliente.entries()].map(([cliente, productos]) => (
        <section key={cliente} className="flex flex-col gap-2">
          <h3 className="rounded-lg bg-menu px-3 py-2 text-[13.5px] font-semibold">{`Cliente: ${cliente}`}</h3>
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
    <div className="mx-auto w-full max-w-xl">
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
