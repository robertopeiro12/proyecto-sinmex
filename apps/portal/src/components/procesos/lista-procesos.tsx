"use client";

import { useEffect, useRef, useState } from "react";
import { Aviso } from "@/components/ui/aviso";
import { Button } from "@/components/ui/button";
import { useConfirmar } from "@/components/ui/confirmar";
import { Etiqueta, type TonoEtiqueta } from "@/components/ui/etiqueta";
import { EstadoPantalla } from "@/components/ui/estado-pantalla";
import { CajaTabla, Fila, FilaVacia, Tabla, Td, Th } from "@/components/ui/tabla";
import { mensajeDe } from "@/lib/api";
import { formatearDiaLargo } from "@/lib/formato";
import {
  eliminarProceso,
  infoDeProceso,
  listarProcesos,
  type LineaProceso,
  type Proceso,
  type ProcesosDelDia,
  type TipoProceso,
} from "@/lib/procesos";

/** "de hoy" / "del lunes 23 de noviembre". */
export function fraseDia(fecha: string, hoy: string): string {
  return fecha === hoy ? "de hoy" : `del ${formatearDiaLargo(fecha)}`;
}

function Pastillas({ lineas, tono }: { lineas: LineaProceso[]; tono: TonoEtiqueta }) {
  if (lineas.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {lineas.map((l) => (
        <Etiqueta key={`${l.sentido}-${l.presentacionId}`} tono={tono}>
          {`${l.nombre} · ${l.piezas}`}
        </Etiqueta>
      ))}
    </div>
  );
}

/**
 * La lista del día de una pestaña de Procesos (D1), debajo de la captura: Hora · Quién ·
 * (Cliente) · Recibido / Entregado o Productos · Capturó · Editar · Eliminar.
 */
export function ListaProcesos({
  tipo,
  sucursal,
  fecha,
  hoy,
  cliente,
  version,
  editandoId,
  onEditar,
  onEliminado,
  onCargada,
}: {
  tipo: TipoProceso;
  sucursal: string;
  fecha: string;
  hoy: string;
  /** Con cliente, solo lo de ese cliente; sin él, toda la sucursal. */
  cliente: { id: string } | null;
  /** Cambia al guardar: la lista se vuelve a pedir. */
  version: number;
  editandoId: string | null;
  onEditar: (p: Proceso) => void;
  onEliminado: (p: Proceso) => void;
  /** Avisa cada lista que llega (la pantalla la usa para el aviso de descuento repetido). */
  onCargada?: (datos: ProcesosDelDia) => void;
}) {
  const info = infoDeProceso(tipo);
  const [datos, setDatos] = useState<ProcesosDelDia | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorAccion, setErrorAccion] = useState<string | null>(null);
  const [vuelta, setVuelta] = useState(0);
  const ultima = useRef(0);
  const { confirmar, ventana } = useConfirmar();
  const clienteId = cliente?.id ?? null;
  // En un ref: la lista no se vuelve a pedir porque cambie quien escucha.
  const avisarCargada = useRef(onCargada);
  useEffect(() => {
    avisarCargada.current = onCargada;
  });

  useEffect(() => {
    const esta = ++ultima.current;
    setCargando(true);
    listarProcesos({ tipo, fecha, sucursal, ...(clienteId ? { cliente: clienteId } : {}) })
      .then((r) => {
        if (esta !== ultima.current) return;
        setDatos(r);
        setError(null);
        avisarCargada.current?.(r);
      })
      .catch((err: unknown) => {
        if (esta !== ultima.current) return;
        setDatos(null);
        setError(mensajeDe(err, "No se pudo cargar la lista del día."));
      })
      .finally(() => {
        if (esta === ultima.current) setCargando(false);
      });
  }, [tipo, fecha, sucursal, clienteId, version, vuelta]);

  async function eliminar(p: Proceso) {
    const si = await confirmar({
      titulo: "¿Eliminar este registro?",
      descripcion: `Se da de baja el registro de ${info.etiqueta.toLowerCase()} de las ${p.hora}. No se puede deshacer.`,
      confirmar: "Eliminar",
    });
    if (!si) return;
    setErrorAccion(null);
    try {
      await eliminarProceso(p.id);
      onEliminado(p);
    } catch (err) {
      setErrorAccion(mensajeDe(err, "No se pudo eliminar el registro."));
    }
    setVuelta((v) => v + 1);
  }

  const dosColumnas = tipo === "merma" || tipo === "cambio";
  const conCliente = tipo === "merma" && !clienteId;
  const columnas = 4 + (dosColumnas ? 2 : 1) + (conCliente ? 1 : 0);
  const procesos = datos?.procesos ?? [];
  const deQuien = clienteId ? "de este cliente" : "de la sucursal";

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-base font-semibold">{`${info.plural} ${fraseDia(fecha, hoy)} ${deQuien}`}</h2>
      {error && <Aviso tono="error">{error}</Aviso>}
      {errorAccion && <Aviso tono="error">{errorAccion}</Aviso>}
      {cargando && !datos && <EstadoPantalla tipo="cargando" />}
      {datos && (
        <CajaTabla className={cargando ? "opacity-60" : undefined}>
          <Tabla aria-label={`${info.plural} del día`} className="table-fixed">
            <colgroup>
              <col className="w-16" />
              <col className="w-32" />
              {conCliente && <col className="w-40" />}
              <col />
              {dosColumnas && <col />}
              <col className="w-36" />
              <col className="w-40" />
            </colgroup>
            <thead>
              <tr>
                <Th>Hora</Th>
                <Th>Quién</Th>
                {conCliente && <Th>Cliente</Th>}
                {dosColumnas ? (
                  <>
                    <Th>Recibido</Th>
                    <Th>Entregado</Th>
                  </>
                ) : (
                  <Th>Productos</Th>
                )}
                <Th>Capturó</Th>
                <Th>
                  <span className="sr-only">Acciones</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {procesos.length === 0 ? (
                <FilaVacia columnas={columnas}>No hay registros ese día.</FilaVacia>
              ) : (
                procesos.map((p) => (
                  <Fila key={p.id} className={editandoId === p.id ? "bg-info-soft/40 align-middle" : "align-middle"}>
                    <Td>{p.hora}</Td>
                    <Td className="truncate">{p.vendedor ? p.vendedor.nombre : <Etiqueta>Oficina</Etiqueta>}</Td>
                    {conCliente && (
                      <Td className="truncate" title={p.cliente?.nombre}>
                        {p.cliente ? p.cliente.nombre : <Etiqueta>Almacén</Etiqueta>}
                      </Td>
                    )}
                    {dosColumnas ? (
                      <>
                        <Td>
                          <Pastillas lineas={p.lineas.filter((l) => l.sentido === "recibido")} tono="error" />
                        </Td>
                        <Td>
                          <Pastillas lineas={p.lineas.filter((l) => l.sentido === "entregado")} tono="exito" />
                        </Td>
                      </>
                    ) : (
                      <Td>
                        <Pastillas lineas={p.lineas} tono="neutro" />
                      </Td>
                    )}
                    <Td className="truncate">{p.capturo}</Td>
                    <Td alinear="derecha">
                      <div className="flex justify-end gap-1">
                        <Button type="button" size="sm" variant="outline" onClick={() => onEditar(p)}>
                          Editar
                        </Button>
                        <Button type="button" size="sm" variant="outline" onClick={() => void eliminar(p)}>
                          Eliminar
                        </Button>
                      </div>
                    </Td>
                  </Fila>
                ))
              )}
            </tbody>
          </Tabla>
        </CajaTabla>
      )}
      {ventana}
    </section>
  );
}
