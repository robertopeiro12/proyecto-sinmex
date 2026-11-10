"use client";

import { useEffect, useMemo, useState } from "react";
import { Aviso } from "@/components/ui/aviso";
import { Button } from "@/components/ui/button";
import { Campo, Entrada } from "@/components/ui/campo";
import { CajaTabla, FilaVacia, Tabla, Td, TdMonto, Th } from "@/components/ui/tabla";
import { Fecha } from "@/components/ui/fecha";
import { Ventana } from "@/components/ui/ventana";
import { mensajeDe } from "@/lib/api";
import { formatearDiaLargo } from "@/lib/formato";
import {
  asignarNota,
  filtrarPorFolio,
  obtenerNotas,
  quitarNota,
  type NotaDeRuta,
  type NotasDeRuta,
} from "@/lib/rutas";

/**
 * Las notas por cobrar de un vendedor en un día (spec §5.4). "pendientes" = las de los
 * clientes de su ruta con saldo (Asignar / Quitar / Pasársela); "asignadas" = las que ya
 * trae (Quitar). Cada clic llama al endpoint y repinta con su respuesta: no hay Guardar.
 * Un día pasado se ve sin acciones.
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
  cuales: "pendientes" | "asignadas";
  /** Al cerrar la lista del día debe volver a pedir sus conteos. */
  alCerrar: () => void;
}) {
  const [listas, setListas] = useState<NotasDeRuta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [trabajando, setTrabajando] = useState(false);
  const [busqueda, setBusqueda] = useState("");

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

  const visibles = useMemo(() => filtrarPorFolio(listas?.[cuales] ?? [], busqueda), [listas, cuales, busqueda]);

  async function accion(nota: NotaDeRuta, quitar: boolean) {
    setTrabajando(true);
    setError(null);
    try {
      setListas(
        quitar
          ? await quitarNota(nota.ventaNotaId, vendedorId, fecha)
          : await asignarNota(nota.ventaNotaId, vendedorId, fecha),
      );
    } catch (err) {
      setError(mensajeDe(err, quitar ? "No se pudo quitar la nota." : "No se pudo asignar la nota."));
    } finally {
      setTrabajando(false);
    }
  }

  function celdaAccion(n: NotaDeRuta) {
    if (!editable) return n.asignadaA && n.asignadaA.vendedorId !== vendedorId ? `La trae ${n.asignadaA.nombre}` : null;
    const boton = (texto: string, quitar: boolean) => (
      <Button type="button" size="sm" variant="outline" disabled={trabajando} onClick={() => void accion(n, quitar)}>
        {texto}
      </Button>
    );
    if (!n.asignadaA) return boton("Asignar", false);
    if (n.asignadaA.vendedorId === vendedorId) return boton("Quitar", true);
    return (
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">La trae {n.asignadaA.nombre}</span>
        {boton("Pasársela", false)}
      </div>
    );
  }

  return (
    <Ventana abierta alCerrar={alCerrar} titulo={`Notas para ${vendedorNombre} · ${formatearDiaLargo(fecha)}`} ancho="detalle">
      <div className="flex flex-col gap-3">
        {error ? <Aviso tono="error">{error}</Aviso> : null}
        {!editable ? <Aviso tono="informacion">Ese día ya pasó; solo se puede consultar.</Aviso> : null}
        <Campo id="notas-buscar" etiqueta="Buscar por folio" className="w-64">
          <Entrada value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
        </Campo>
        {listas === null ? (
          error ? null : (
            <p className="text-sm text-muted-foreground">Cargando…</p>
          )
        ) : (
          <CajaTabla altoMaximo="50dvh">
            <Tabla className="table-fixed">
              <colgroup>
                <col />
                <col className="w-[150px]" />
                <col className="w-[96px]" />
                <col className="w-[140px]" />
                <col className="w-[90px]" />
                <col className="w-[240px]" />
              </colgroup>
              <thead>
                <tr>
                  <Th>Cliente</Th>
                  <Th>Folio</Th>
                  <Th>Fecha</Th>
                  <Th alinear="derecha">Saldo</Th>
                  <Th alinear="derecha" className="whitespace-normal leading-tight">Días de atraso</Th>
                  <Th>Acción</Th>
                </tr>
              </thead>
              <tbody>
                {visibles.length === 0 ? (
                  <FilaVacia columnas={6}>No hay notas por cobrar.</FilaVacia>
                ) : (
                  visibles.map((n) => (
                    <tr key={n.ventaNotaId}>
                      <Td className="truncate" title={n.cliente}>
                        {n.cliente}
                      </Td>
                      <Td className="truncate tabular-nums">{n.folio}</Td>
                      <Td>
                        <Fecha valor={n.fecha} />
                      </Td>
                      <TdMonto centavos={n.saldoCentavos} />
                      <Td alinear="derecha">{n.diasAtraso}</Td>
                      <Td>{celdaAccion(n)}</Td>
                    </tr>
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
