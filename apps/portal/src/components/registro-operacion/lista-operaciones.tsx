"use client";

import { useEffect, useRef, useState } from "react";
import { Aviso } from "@/components/ui/aviso";
import { Button } from "@/components/ui/button";
import { Campo, Entrada } from "@/components/ui/campo";
import { useConfirmar } from "@/components/ui/confirmar";
import { EstadoPantalla } from "@/components/ui/estado-pantalla";
import { CajaTabla, Fila, FilaVacia, Tabla, Td, Th } from "@/components/ui/tabla";
import { mensajeDe } from "@/lib/api";
import { diaAnterior } from "@/lib/fechas";
import {
  eliminarOperacion,
  listarOperaciones,
  type OperacionAlmacen,
  type OperacionesDelDia,
  type TipoOperacion,
} from "@/lib/operaciones-almacen";
import { hoyEnTijuana } from "@/lib/ventas";
import { diaDeEnvio, SelectorDiaEnvio } from "./selector-dia-envio";

const COLUMNAS = 7;
const ORIGEN = { produccion: "Producción", compra: "Compra" } as const;

const TEXTO_REGISTRAR: Record<TipoOperacion, string> = {
  entrada: "Registrar entrada",
  envio: "Registrar envío",
  merma: "Registrar merma",
  consumo: "Registrar consumo",
  descuento: "Registrar descuento",
};

const TITULO_DATO: Record<TipoOperacion, string> = {
  entrada: "Origen",
  envio: "Destino",
  merma: "Motivo",
  consumo: "Detalle",
  descuento: "Trabajador",
};

function datoDe(o: OperacionAlmacen): string {
  if (o.envio) return `Envío desde ${o.envio.origen.codigo}`;
  switch (o.tipo) {
    case "entrada":
      return o.origen ? ORIGEN[o.origen] : "—";
    case "envio":
      return o.destino?.codigo ?? "—";
    case "merma":
      return o.motivo?.nombre ?? "—";
    case "descuento":
      return o.trabajador ?? "—";
    default:
      return o.comentario ?? "—";
  }
}

const detalleDe = (o: OperacionAlmacen) => o.lineas.map((l) => `${l.nombre} × ${l.piezas}`).join(", ");

/** La lista de un tipo para un día (Hoy · Ayer; en Envíos, solo esos dos días). */
export function ListaOperaciones({
  tipo,
  sucursal,
  fecha,
  onFecha,
  onCapturar,
}: {
  tipo: TipoOperacion;
  sucursal: string;
  fecha: string;
  onFecha: (fecha: string) => void;
  onCapturar: (operacion: OperacionAlmacen | null) => void;
}) {
  const hoy = hoyEnTijuana();
  const ayer = diaAnterior(hoy);
  // Un envío solo vive hoy o ayer: si venía otro día de otra pestaña, se muestra hoy.
  const dia = tipo === "envio" ? diaDeEnvio(fecha) : fecha;
  const [datos, setDatos] = useState<OperacionesDelDia | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [vuelta, setVuelta] = useState(0);
  const ultima = useRef(0);
  const { confirmar, ventana } = useConfirmar();

  useEffect(() => {
    const esta = ++ultima.current;
    setCargando(true);
    listarOperaciones({ fecha: dia, tipo, sucursal })
      .then((r) => {
        if (esta !== ultima.current) return;
        setDatos(r);
        setError(null);
      })
      .catch((err: unknown) => {
        if (esta !== ultima.current) return;
        setDatos(null);
        setError(mensajeDe(err, "No se pudo cargar el registro del día."));
      })
      .finally(() => {
        if (esta === ultima.current) setCargando(false);
      });
  }, [dia, tipo, sucursal, vuelta]);

  function cambiar(nueva: string) {
    if (nueva === "" || nueva > hoy) return;
    onFecha(nueva);
  }

  async function eliminar(o: OperacionAlmacen) {
    const si = await confirmar({
      titulo: "¿Eliminar este registro?",
      descripcion: `Se da de baja el registro de ${o.piezas} piezas de las ${o.hora}. No se puede deshacer.`,
      confirmar: "Eliminar registro",
    });
    if (!si) return;
    try {
      await eliminarOperacion(o.id);
      setVuelta((v) => v + 1);
    } catch (err) {
      setError(mensajeDe(err, "No se pudo eliminar el registro."));
    }
  }

  const operaciones = datos?.operaciones ?? [];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end gap-3">
        {tipo === "envio" ? (
          <SelectorDiaEnvio valor={dia} onCambio={cambiar} />
        ) : (
          <>
            <Campo id={`dia-${tipo}`} etiqueta="Día" className="w-48">
              <Entrada type="date" required max={hoy} value={dia} onChange={(e) => cambiar(e.target.value)} />
            </Campo>
            <div role="group" aria-label="Atajos de día" className="flex items-center gap-0.5">
              <Button type="button" variant="ghost" size="sm" onClick={() => cambiar(hoy)}>
                Hoy
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => cambiar(ayer)}>
                Ayer
              </Button>
            </div>
          </>
        )}
        <div className="ml-auto">
          <Button type="button" onClick={() => onCapturar(null)}>
            {TEXTO_REGISTRAR[tipo]}
          </Button>
        </div>
      </div>

      {error && <Aviso tono="error">{error}</Aviso>}
      {cargando && !datos && <EstadoPantalla tipo="cargando" />}

      {datos && (
        <CajaTabla className={cargando ? "opacity-60" : undefined}>
          <Tabla aria-label="Operaciones del día" className="table-fixed">
            <colgroup>
              <col className="w-20" />
              <col className="w-36" />
              <col className="w-20" />
              <col className="w-44" />
              <col />
              <col className="w-52" />
            </colgroup>
            <thead>
              <tr>
                <Th>Hora</Th>
                <Th>Capturó</Th>
                <Th alinear="derecha">Piezas</Th>
                <Th>{TITULO_DATO[tipo]}</Th>
                <Th>Productos</Th>
                <Th>
                  <span className="sr-only">Acciones</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {operaciones.length === 0 ? (
                <FilaVacia columnas={COLUMNAS - 1}>No hay registros ese día.</FilaVacia>
              ) : (
                operaciones.map((o) => (
                  <Fila key={o.id} className="align-middle">
                    <Td>{o.hora}</Td>
                    <Td className="truncate">{o.capturo}</Td>
                    <Td alinear="derecha">{o.piezas}</Td>
                    <Td className="truncate">{datoDe(o)}</Td>
                    <Td className="truncate text-muted-foreground" title={detalleDe(o)}>
                      {detalleDe(o)}
                    </Td>
                    <Td alinear="derecha">
                      {o.editable && !o.envio && (
                        <div className="flex justify-end gap-1">
                          <Button type="button" size="sm" variant="outline" onClick={() => onCapturar(o)}>
                            Editar
                          </Button>
                          <Button type="button" size="sm" variant="outline" onClick={() => eliminar(o)}>
                            Eliminar
                          </Button>
                        </div>
                      )}
                    </Td>
                  </Fila>
                ))
              )}
            </tbody>
          </Tabla>
        </CajaTabla>
      )}
      {ventana}
    </div>
  );
}
