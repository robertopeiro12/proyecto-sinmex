"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Aviso } from "@/components/ui/aviso";
import { Button } from "@/components/ui/button";
import { Campo, Entrada } from "@/components/ui/campo";
import { Etiqueta } from "@/components/ui/etiqueta";
import { Fecha } from "@/components/ui/fecha";
import { SelectorSegmentado } from "@/components/ui/selector-segmentado";
import { CajaTabla, FilaVacia, Tabla, Td, TdMonto, Th } from "@/components/ui/tabla";
import { Ventana } from "@/components/ui/ventana";
import { mensajeDe } from "@/lib/api";
import { formatearDiaLargo, formatearPesos, plural } from "@/lib/formato";
import { cn } from "@/lib/utils";
import {
  agruparPorCliente,
  asignarNota,
  filtrarPorFolio,
  obtenerNotas,
  quitarNota,
  TEXTO_CONDICION_CORTO,
  unirNotas,
  type CondicionVenta,
  type NotaDeRuta,
  type NotasDeRuta,
} from "@/lib/rutas";

type Filtro = "todas" | "asignadas";

const COLUMNAS = 6;
const OPCIONES_CONDICION = (Object.keys(TEXTO_CONDICION_CORTO) as CondicionVenta[]).map((c) => ({
  valor: c,
  texto: TEXTO_CONDICION_CORTO[c],
}));

/**
 * Las notas por cobrar de un vendedor en un día (spec §5.4): las de los clientes de su ruta
 * con saldo y las que ya trae, juntas y agrupadas por cliente en el orden de la ruta. El
 * filtro "Asignadas a…" deja solo las suyas. Cada clic llama al endpoint y repinta con su
 * respuesta: no hay Guardar. Un día pasado se ve sin acciones.
 */
export function VentanaNotas({
  vendedorId,
  vendedorNombre,
  fecha,
  editable,
  cuales,
  alCerrar,
}: {
  vendedorId: string;
  vendedorNombre: string;
  fecha: string;
  editable: boolean;
  /** Con qué filtro abre: "pendientes" = Todas; "asignadas" = solo las suyas. */
  cuales: "pendientes" | "asignadas";
  /** Al cerrar la lista del día debe volver a pedir sus conteos. */
  alCerrar: () => void;
}) {
  const [listas, setListas] = useState<NotasDeRuta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [trabajando, setTrabajando] = useState(false);
  const [busqueda, setBusqueda] = useState("");
  const [filtro, setFiltro] = useState<Filtro>(cuales === "asignadas" ? "asignadas" : "todas");
  // Condición elegida por nota; sin tocar, la de la asignación actual o "ninguna".
  const [elegidas, setElegidas] = useState<Record<string, CondicionVenta>>({});

  useEffect(() => {
    let vigente = true;
    obtenerNotas(vendedorId, fecha)
      .then((l) => {
        if (vigente) setListas(l);
      })
      .catch((err: unknown) => {
        if (vigente) setError(mensajeDe(err, "No se pudieron cargar las notas."));
      });
    return () => {
      vigente = false;
    };
  }, [vendedorId, fecha]);

  const esPropia = (n: NotaDeRuta) => n.asignadaA?.vendedorId === vendedorId;
  const todas = useMemo(() => (listas ? unirNotas(listas) : []), [listas]);
  const grupos = useMemo(() => {
    const delFiltro = filtro === "asignadas" ? todas.filter((n) => n.asignadaA?.vendedorId === vendedorId) : todas;
    return agruparPorCliente(filtrarPorFolio(delFiltro, busqueda));
  }, [todas, filtro, busqueda, vendedorId]);

  const asignadas = listas?.asignadas ?? [];
  const totalAsignado = asignadas.reduce((s, n) => s + n.saldoCentavos, 0);
  const nombreCorto = vendedorNombre.trim().split(/\s+/)[0] || vendedorNombre;

  const condicionDe = (n: NotaDeRuta): CondicionVenta =>
    elegidas[n.ventaNotaId] ?? n.asignadaA?.condicionVenta ?? "ninguna";

  async function accion(nota: NotaDeRuta, quitar: boolean) {
    setTrabajando(true);
    setError(null);
    try {
      setListas(
        quitar
          ? await quitarNota(nota.ventaNotaId, vendedorId, fecha)
          : await asignarNota(nota.ventaNotaId, vendedorId, fecha, condicionDe(nota)),
      );
      // La elección ya quedó en la asignación: si la nota vuelve a quedar libre
      // debe empezar otra vez en "ninguna".
      setElegidas((prev) => {
        const resto = { ...prev };
        delete resto[nota.ventaNotaId];
        return resto;
      });
    } catch (err) {
      setError(mensajeDe(err, quitar ? "No se pudo quitar la nota." : "No se pudo asignar la nota."));
    } finally {
      setTrabajando(false);
    }
  }

  function textoCondicion(c: CondicionVenta) {
    return c === "ninguna" ? (
      <span className="text-muted-foreground">{TEXTO_CONDICION_CORTO.ninguna}</span>
    ) : (
      <Etiqueta tono="advertencia">{TEXTO_CONDICION_CORTO[c]}</Etiqueta>
    );
  }

  function celdaCondicion(n: NotaDeRuta) {
    if (!editable || esPropia(n)) return n.asignadaA ? textoCondicion(n.asignadaA.condicionVenta) : null;
    return (
      <SelectorSegmentado
        etiqueta={`Condición de la nota ${n.folio}`}
        opciones={OPCIONES_CONDICION}
        valor={condicionDe(n)}
        onCambio={(c) => setElegidas((prev) => ({ ...prev, [n.ventaNotaId]: c }))}
      />
    );
  }

  function celdaAccion(n: NotaDeRuta) {
    if (!editable) {
      if (!n.asignadaA) return null;
      return esPropia(n) ? "Asignada" : `La trae ${n.asignadaA.nombre}`;
    }
    if (!n.asignadaA) {
      return (
        <Button type="button" size="sm" disabled={trabajando} onClick={() => void accion(n, false)}>
          Asignar
        </Button>
      );
    }
    if (esPropia(n)) {
      return (
        <Button type="button" size="sm" variant="ghost" disabled={trabajando} onClick={() => void accion(n, true)}>
          Quitar
        </Button>
      );
    }
    return (
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-muted-foreground">La trae {n.asignadaA.nombre}</span>
        <Button type="button" size="sm" variant="outline" disabled={trabajando} onClick={() => void accion(n, false)}>
          Pasársela
        </Button>
      </div>
    );
  }

  function atraso(dias: number) {
    return dias > 0 ? (
      <span className="font-medium text-warning">{plural(dias, "día", "días")}</span>
    ) : (
      <span className="text-muted-foreground">Al día</span>
    );
  }

  return (
    <Ventana
      abierta
      alCerrar={alCerrar}
      titulo={`Notas por cobrar de ${vendedorNombre} · ${formatearDiaLargo(fecha)}`}
      ancho="detalle"
    >
      <div className="flex flex-col gap-3">
        {error ? <Aviso tono="error">{error}</Aviso> : null}
        {!editable ? <Aviso tono="informacion">Ese día ya pasó; solo se puede consultar.</Aviso> : null}
        <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
          <p className="pb-2 text-sm" aria-live="polite">
            {listas === null ? null : asignadas.length > 0 ? (
              <>
                {vendedorNombre} trae <span className="font-medium tabular-nums">{plural(asignadas.length, "nota", "notas")}</span>
                {" · "}
                <span className="font-medium tabular-nums">{formatearPesos(totalAsignado)}</span>
              </>
            ) : (
              <span className="text-muted-foreground">{vendedorNombre} no trae notas asignadas</span>
            )}
          </p>
          <div className="ml-auto flex flex-wrap items-end gap-3">
            <div className="pb-0.5">
              <SelectorSegmentado
                etiqueta="Qué notas ver"
                valor={filtro}
                onCambio={setFiltro}
                opciones={[
                  { valor: "todas", texto: "Todas" },
                  { valor: "asignadas", texto: `Asignadas a ${nombreCorto} (${asignadas.length})` },
                ]}
              />
            </div>
            <Campo id="notas-buscar" etiqueta="Buscar por folio" className="w-56">
              <Entrada value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
            </Campo>
          </div>
        </div>
        {listas === null ? (
          error ? null : (
            <p className="text-sm text-muted-foreground">Cargando…</p>
          )
        ) : (
          <CajaTabla altoMaximo="50dvh">
            <Tabla className="table-fixed">
              {/* ≈1108 px en la ventana de 72rem: Folio se lleva lo que sobra. */}
              <colgroup>
                <col />
                <col className="w-[104px]" />
                <col className="w-[112px]" />
                <col className="w-[84px]" />
                <col className="w-[392px]" />
                <col className="w-[210px]" />
              </colgroup>
              <thead>
                <tr>
                  <Th>Folio</Th>
                  <Th>Fecha</Th>
                  <Th alinear="derecha">Saldo</Th>
                  <Th>Atraso</Th>
                  <Th>Condición</Th>
                  <Th>Acción</Th>
                </tr>
              </thead>
              <tbody>
                {grupos.length === 0 ? (
                  <FilaVacia columnas={COLUMNAS}>
                    {todas.length === 0
                      ? "No hay notas por cobrar en la ruta de este día."
                      : filtro === "asignadas" && busqueda.trim() === ""
                        ? `${vendedorNombre} no trae notas asignadas.`
                        : "Ninguna nota tiene ese folio."}
                  </FilaVacia>
                ) : (
                  grupos.map((g) => (
                    <GrupoNotas key={g.clienteId} cliente={g.cliente} cuantas={g.notas.length} saldo={g.saldoCentavos}>
                      {g.notas.map((n) => {
                        const propia = esPropia(n);
                        const deOtro = n.asignadaA !== null && !propia;
                        return (
                          <tr
                            key={n.ventaNotaId}
                            className={cn(propia && "bg-primary/5", deOtro && "text-muted-foreground")}
                          >
                            <Td className="truncate tabular-nums" title={n.folio}>
                              {n.folio}
                            </Td>
                            <Td>
                              <Fecha valor={n.fecha} />
                            </Td>
                            <TdMonto centavos={n.saldoCentavos} />
                            <Td>{atraso(n.diasAtraso)}</Td>
                            <Td>{celdaCondicion(n)}</Td>
                            <Td>{celdaAccion(n)}</Td>
                          </tr>
                        );
                      })}
                    </GrupoNotas>
                  ))
                )}
              </tbody>
            </Tabla>
          </CajaTabla>
        )}
      </div>
    </Ventana>
  );
}

/** El renglón del cliente (fondo muted) y debajo sus notas. */
function GrupoNotas({
  cliente,
  cuantas,
  saldo,
  children,
}: {
  cliente: string;
  cuantas: number;
  saldo: number;
  children: ReactNode;
}) {
  return (
    <>
      <tr>
        <th colSpan={COLUMNAS} scope="rowgroup" className="border-b bg-muted px-3 py-2 text-left font-normal">
          <div className="flex items-center justify-between gap-3">
            <span className="truncate font-medium" title={cliente}>
              {cliente}
            </span>
            <span className="shrink-0 text-muted-foreground tabular-nums">
              {plural(cuantas, "nota", "notas")} · {formatearPesos(saldo)}
            </span>
          </div>
        </th>
      </tr>
      {children}
    </>
  );
}
