"use client";

import { useEffect, useRef, useState } from "react";
import { Aviso } from "@/components/ui/aviso";
import { Button } from "@/components/ui/button";
import { useConfirmar } from "@/components/ui/confirmar";
import { Etiqueta, type TonoEtiqueta } from "@/components/ui/etiqueta";
import { EstadoPantalla } from "@/components/ui/estado-pantalla";
import { CajaTabla, Fila, FilaVacia, Tabla, Td, Th } from "@/components/ui/tabla";
import { ErrorApi, mensajeDe } from "@/lib/api";
import {
  cargaEditable,
  eliminarCarga,
  ETIQUETA_ESTADO,
  obtenerRejilla,
  totalPiezas,
  type CargaRejilla,
  type EstadoCarga,
  type Rejilla,
} from "@/lib/cargas";
import { listarSucursales } from "@/lib/sucursales";
import { hoyEnTijuana } from "@/lib/ventas";

const TONO: Record<EstadoCarga, TonoEtiqueta> = { pendiente: "advertencia", aceptada: "exito", rechazada: "error" };

/**
 * La lista de recargas de HOY de la sucursal del menú (el cliente: la recarga siempre es
 * del día actual). Una fila por carga; editar o eliminar solo si aún no la acepta el vendedor.
 */
export function ListaRecargas({
  sucursal,
  aviso,
  onCapturar,
}: {
  /** Código de la sucursal del menú lateral. */
  sucursal: string;
  aviso: string | null;
  onCapturar: (rejilla: Rejilla, carga: CargaRejilla | null, vendedorId: string) => void;
}) {
  const [rejilla, setRejilla] = useState<Rejilla | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [vuelta, setVuelta] = useState(0);
  const ultima = useRef(0);
  const { confirmar, ventana } = useConfirmar();

  useEffect(() => {
    const esta = ++ultima.current;
    setCargando(true);
    (async () => {
      const sucursales = await listarSucursales();
      const suc = sucursales.find((s) => s.codigo === sucursal);
      if (!suc) throw new Error("No se encontró la sucursal.");
      return obtenerRejilla(hoyEnTijuana(), suc.id);
    })()
      .then((r) => {
        if (esta !== ultima.current) return;
        setRejilla(r);
        setError(null);
      })
      .catch((err: unknown) => {
        if (esta !== ultima.current) return;
        setRejilla(null);
        setError(mensajeDe(err, "No se pudo cargar las recargas del día."));
      })
      .finally(() => {
        if (esta === ultima.current) setCargando(false);
      });
  }, [sucursal, vuelta]);

  async function eliminar(vendedor: string, carga: CargaRejilla) {
    const si = await confirmar({
      titulo: `¿Eliminar la recarga n.º ${carga.numero} de ${vendedor}?`,
      descripcion: "No se puede deshacer.",
      confirmar: "Eliminar recarga",
    });
    if (!si) return;
    try {
      await eliminarCarga(carga.id, carga.version);
      setVuelta((v) => v + 1);
    } catch (err) {
      setError(mensajeDe(err, "No se pudo eliminar la recarga."));
      if (err instanceof ErrorApi && err.status === 409) setVuelta((v) => v + 1);
    }
  }

  const nombres = new Map((rejilla?.presentaciones ?? []).map((p) => [p.id, `${p.productoNombre} ${p.volumen}`]));
  const filas = (rejilla?.vendedores ?? [])
    .flatMap((v) => v.cargas.map((c) => ({ vendedor: v, carga: c })))
    .sort((a, b) => a.vendedor.nombre.localeCompare(b.vendedor.nombre, "es") || a.carga.numero - b.carga.numero);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end gap-3">
        <p className="text-sm text-muted-foreground">
          Solo se capturan recargas de hoy. Las de días anteriores se ven en Inventario por vendedor → Recargas.
        </p>
        <div className="ml-auto">
          <Button type="button" disabled={!rejilla || rejilla.vendedores.length === 0} onClick={() => rejilla && onCapturar(rejilla, null, "")}>
            Registrar recarga
          </Button>
        </div>
      </div>

      {aviso && <Aviso tono="exito">{aviso}</Aviso>}
      {error && <Aviso tono="error">{error}</Aviso>}
      {cargando && !rejilla && <EstadoPantalla tipo="cargando" />}

      {rejilla && (
        <CajaTabla className={cargando ? "opacity-60" : undefined}>
          <Tabla aria-label="Recargas de hoy" className="table-fixed">
            <colgroup>
              <col className="w-40" />
              <col className="w-24" />
              <col className="w-20" />
              <col />
              <col className="w-44" />
              <col className="w-44" />
            </colgroup>
            <thead>
              <tr>
                <Th>Vendedor</Th>
                <Th alinear="derecha">Recarga</Th>
                <Th alinear="derecha">Piezas</Th>
                <Th>Productos</Th>
                <Th>Estado</Th>
                <Th>
                  <span className="sr-only">Acciones</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {filas.length === 0 ? (
                <FilaVacia columnas={6}>Todavía no hay recargas hoy.</FilaVacia>
              ) : (
                filas.map(({ vendedor, carga }) => {
                  const detalle = carga.lineas.map((l) => `${nombres.get(l.presentacionId) ?? "Producto"} × ${l.piezas}`).join(", ");
                  return (
                    <Fila key={carga.id} className="align-middle">
                      <Td className="truncate">{vendedor.nombre}</Td>
                      <Td alinear="derecha">{`n.º ${carga.numero}`}</Td>
                      <Td alinear="derecha">{totalPiezas(carga.lineas)}</Td>
                      <Td className="truncate text-muted-foreground" title={detalle}>
                        {detalle}
                      </Td>
                      <Td>
                        <Etiqueta tono={TONO[carga.estado]}>{ETIQUETA_ESTADO[carga.estado]}</Etiqueta>
                        {carga.estado === "rechazada" && carga.motivoRechazo && (
                          <p className="mt-1 whitespace-normal text-xs text-destructive">{carga.motivoRechazo}</p>
                        )}
                      </Td>
                      <Td alinear="derecha">
                        {cargaEditable(carga, true) && (
                          <div className="flex justify-end gap-1">
                            <Button type="button" size="sm" variant="outline" onClick={() => onCapturar(rejilla, carga, vendedor.id)}>
                              Editar
                            </Button>
                            <Button type="button" size="sm" variant="outline" onClick={() => void eliminar(vendedor.nombre, carga)}>
                              Eliminar
                            </Button>
                          </div>
                        )}
                      </Td>
                    </Fila>
                  );
                })
              )}
            </tbody>
          </Tabla>
        </CajaTabla>
      )}
      {ventana}
    </div>
  );
}
