"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight } from "lucide-react";
import { Aviso } from "@/components/ui/aviso";
import { Button } from "@/components/ui/button";
import { useConfirmar } from "@/components/ui/confirmar";
import { Campo, Entrada, Lista } from "@/components/ui/campo";
import { SelectorSegmentado } from "@/components/ui/selector-segmentado";
import { mensajeDe } from "@/lib/api";
import { formatearDiaLargo } from "@/lib/formato";
import {
  crearProceso,
  cuadre,
  editarProceso,
  infoDeProceso,
  llevaCliente,
  llevaDosCajas,
  MAX_COMENTARIO_PROCESO,
  precargaDescuentos,
  type DatosProceso,
  type MermaDe,
  type Proceso,
  type TipoProceso,
} from "@/lib/procesos";
import type { Vendedor } from "@/lib/vendedores";
import { cn } from "@/lib/utils";
import { CajaProductos, piezasValidas, type OpcionPresentacion, type RenglonCaja } from "./caja-productos";

/** Valor del desplegable "¿Quién?" para Oficina: viaja como `vendedorId: null`. */
export const QUIEN_OFICINA = "oficina";

const ETIQUETA_QUIEN: Record<TipoProceso, string> = {
  merma: "¿Quién la recogió?",
  cambio: "¿Quién?",
  consumo: "¿Quién?",
  promocion: "¿Quién?",
  descuento: "Vendedor",
};

/** Títulos de las cajas por tipo: la de recibido (si hay) y la de entregado. */
function titulosCajas(tipo: TipoProceso, mermaDe: MermaDe | null): { recibido: string | null; entregado: string | null } {
  if (tipo === "merma") return mermaDe === "almacen" ? { recibido: "Productos dañados", entregado: null } : { recibido: "Recibí dañado", entregado: "Le entregué" };
  if (tipo === "cambio") return { recibido: "Me regresó", entregado: "Le entregué" };
  return { recibido: null, entregado: "Productos" };
}

/** Un renglón de caja desde una línea guardada o precargada (producto y tamaño salen del catálogo). */
function renglonDe(linea: { presentacionId: string; nombre: string; piezas: number }, opciones: OpcionPresentacion[]): RenglonCaja {
  const o = opciones.find((x) => x.id === linea.presentacionId);
  return {
    presentacionId: linea.presentacionId,
    nombre: linea.nombre,
    producto: o?.producto ?? linea.nombre,
    volumen: o?.volumen ?? "",
    piezas: String(linea.piezas),
  };
}

export type ModoFecha = "hoy" | "otro";

/**
 * La captura de una pestaña de Procesos (D1): fila de opciones, las cajas de productos,
 * la barra de cuadre (Merma de cliente y Cambios), comentario, Limpiar y Guardar. Con
 * `editando`, carga ese registro y guarda con "Guardar cambios" / "Cancelar". Quien la
 * monta le pone `key` por registro: lo escrito vive aquí y se pierde al cambiar de key.
 */
export function CapturaProceso({
  tipo,
  sucursal,
  hoy,
  cliente,
  fecha,
  modoFecha,
  onFecha,
  mermaDe,
  onMermaDe,
  quien,
  onQuien,
  vendedores,
  opciones,
  editando,
  onCancelar,
  onGuardado,
  onSucio,
}: {
  tipo: TipoProceso;
  sucursal: string;
  hoy: string;
  /** El cliente elegido arriba (o el del registro que se corrige). */
  cliente: { id: string; nombre: string } | null;
  fecha: string;
  modoFecha: ModoFecha;
  onFecha: (fecha: string, modo: ModoFecha) => void;
  mermaDe: MermaDe;
  onMermaDe: (m: MermaDe) => void;
  quien: string;
  onQuien: (q: string) => void;
  vendedores: Vendedor[];
  opciones: OpcionPresentacion[];
  editando: Proceso | null;
  onCancelar: () => void;
  onGuardado: () => void;
  onSucio: (sucio: boolean) => void;
}) {
  const info = infoDeProceso(tipo);
  const mermaDeTipo = tipo === "merma" ? mermaDe : null;
  const titulos = titulosCajas(tipo, mermaDeTipo);
  const dosCajas = llevaDosCajas(tipo, mermaDeTipo);
  const necesitaCliente = llevaCliente(tipo, mermaDeTipo);

  const [recibido, setRecibido] = useState<RenglonCaja[]>(() =>
    (editando?.lineas ?? []).filter((l) => l.sentido === "recibido").map((l) => renglonDe(l, opciones)),
  );
  const [entregado, setEntregado] = useState<RenglonCaja[]>(() =>
    (editando?.lineas ?? []).filter((l) => l.sentido === "entregado").map((l) => renglonDe(l, opciones)),
  );
  const [comentario, setComentario] = useState(editando?.comentario ?? "");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [avisoPrecarga, setAvisoPrecarga] = useState<string | null>(null);
  const precargaVigente = useRef(0);
  // Lo último que precargó Descuentos: si la caja sigue igual, no hay nada escrito a mano.
  const [precargado, setPrecargado] = useState<RenglonCaja[]>([]);
  const { confirmar, ventana } = useConfirmar();

  const sucio = editando !== null || recibido.length > 0 || entregado.length > 0 || comentario.trim() !== "";
  useEffect(() => {
    onSucio(sucio);
  }, [sucio, onSucio]);
  useEffect(() => () => onSucio(false), [onSucio]);

  /** Descuentos (R3): al elegir vendedor o día se precargan los faltantes del corte. */
  async function precargar(vendedor: string, dia: string) {
    const esta = ++precargaVigente.current;
    setAvisoPrecarga(null);
    if (tipo !== "descuento" || editando || dia === "") return;
    if (vendedor === "") {
      setEntregado([]);
      setPrecargado([]);
      return;
    }
    try {
      const r = await precargaDescuentos(vendedor, dia);
      if (esta !== precargaVigente.current) return;
      const renglones = r.lineas.map((l) => renglonDe(l, opciones));
      setEntregado(renglones);
      setPrecargado(renglones);
      setError(null);
      if (!r.corteHecho) setAvisoPrecarga("Ese día no tiene corte hecho: no hay faltantes que precargar.");
      else if (r.lineas.length === 0) setAvisoPrecarga("Ese día no le faltó ninguna pieza.");
    } catch (err) {
      if (esta !== precargaVigente.current) return;
      setError(mensajeDe(err, "No se pudieron precargar los faltantes."));
    }
  }

  /**
   * Descuentos: antes de que la precarga reemplace la caja, pregunta si alguien la
   * escribió o corrigió a mano (lo que precargó el sistema tal cual no cuenta).
   */
  async function soltarCajaDescuento(): Promise<boolean> {
    if (tipo !== "descuento" || editando) return true;
    const igual =
      entregado.length === precargado.length &&
      entregado.every((r, i) => r.presentacionId === precargado[i].presentacionId && r.piezas === precargado[i].piezas);
    if (entregado.length === 0 || igual) return true;
    return confirmar({
      titulo: "¿Descartar lo que escribiste?",
      descripcion: "Los productos de la caja se reemplazan por los faltantes del corte del vendedor y día que elegiste.",
      confirmar: "Descartar",
      tono: "normal",
    });
  }

  async function cambiarQuien(q: string) {
    if (q === quien) return;
    if (!(await soltarCajaDescuento())) return;
    onQuien(q);
    void precargar(q, fecha);
  }

  async function cambiarFecha(dia: string, modo: ModoFecha) {
    if (dia === "" || dia > hoy) return;
    // "Otro día" sin cambiar la fecha solo muestra el campo: no vuelve a precargar.
    // Sin vendedor no hay corte que precargar: la caja se queda como está.
    if (dia === fecha || quien === "") {
      onFecha(dia, modo);
      return;
    }
    if (!(await soltarCajaDescuento())) return;
    onFecha(dia, modo);
    void precargar(quien, dia);
  }

  /** Merma de almacén no lleva "Le entregué": se descarta (preguntando si había algo). */
  async function cambiarMermaDe(m: MermaDe) {
    if (m === "almacen" && entregado.length > 0) {
      const si = await confirmar({
        titulo: "¿Descartar lo que escribiste?",
        descripcion: "La merma de almacén no lleva «Le entregué»: lo que capturaste ahí se pierde.",
        confirmar: "Descartar",
        tono: "normal",
      });
      if (!si) return;
      setEntregado([]);
    }
    onMermaDe(m);
  }

  const visiblesRecibido = titulos.recibido ? recibido : [];
  const visiblesEntregado = titulos.entregado ? entregado : [];
  const todas = [
    ...visiblesRecibido.map((r) => ({ ...r, sentido: "recibido" as const })),
    ...visiblesEntregado.map((r) => ({ ...r, sentido: "entregado" as const })),
  ];
  // Un renglón vacío solo impide guardar; uno con algo que no es número además avisa.
  const hayInvalidas = todas.some((r) => !piezasValidas(r.piezas));
  const hayMalEscritas = todas.some((r) => r.piezas.trim() !== "" && !piezasValidas(r.piezas));
  const barra = cuadre(todas.map((r) => ({ sentido: r.sentido, piezas: piezasValidas(r.piezas) ? Number(r.piezas.trim()) : 0 })));
  const cuadraBien = !dosCajas || (visiblesRecibido.length > 0 && visiblesEntregado.length > 0 && barra.cuadra);
  const sinCliente = necesitaCliente && !cliente;
  const puedeGuardar =
    !guardando &&
    !sinCliente &&
    todas.length > 0 &&
    !hayInvalidas &&
    cuadraBien &&
    !(tipo === "descuento" && quien === "") &&
    fecha !== "" &&
    fecha <= hoy;

  function limpiar() {
    setRecibido([]);
    setEntregado([]);
    setComentario("");
    setError(null);
    setAvisoPrecarga(null);
  }

  async function guardar() {
    setGuardando(true);
    setError(null);
    const datos: DatosProceso = {
      fecha,
      clienteId: necesitaCliente && cliente ? cliente.id : null,
      vendedorId: quien === QUIEN_OFICINA || quien === "" ? null : quien,
      mermaDe: mermaDeTipo,
      comentario: comentario.trim() === "" ? null : comentario.trim(),
      lineas: todas.map((r) => ({ presentacionId: r.presentacionId, sentido: r.sentido, piezas: Number(r.piezas.trim()) })),
    };
    try {
      if (editando) await editarProceso(editando.id, datos);
      else await crearProceso({ tipo, sucursal, ...datos });
      onGuardado();
    } catch (err) {
      setError(mensajeDe(err, "No se pudo guardar el registro."));
      setGuardando(false);
    }
  }

  // Vendedores vivos de la sucursal; el del registro que se corrige aunque ya no lo esté.
  const activos = vendedores.filter((v) => v.activo);
  const opcionesQuien =
    editando?.vendedor && !activos.some((v) => v.id === editando.vendedor!.id)
      ? [...activos, { id: editando.vendedor.id, nombre: editando.vendedor.nombre }]
      : activos;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start gap-6">
        {tipo === "merma" && (
          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] font-semibold">Merma de</span>
            <SelectorSegmentado
              etiqueta="Merma de"
              resaltado
              valor={mermaDe}
              onCambio={(m) => void cambiarMermaDe(m)}
              opciones={[
                { valor: "cliente", texto: "Este cliente" },
                { valor: "almacen", texto: "Almacén" },
              ]}
            />
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-semibold">Fecha</span>
          <div className="flex items-center gap-2">
            <SelectorSegmentado<ModoFecha>
              etiqueta="Fecha"
              resaltado
              valor={modoFecha}
              onCambio={(m) => void cambiarFecha(m === "hoy" ? hoy : fecha, m)}
              opciones={[
                { valor: "hoy", texto: `Hoy · ${formatearDiaLargo(hoy)}` },
                { valor: "otro", texto: "Otro día" },
              ]}
            />
            {modoFecha === "otro" && (
              <Entrada
                type="date"
                aria-label="Día"
                required
                max={hoy}
                value={fecha}
                onChange={(e) => void cambiarFecha(e.target.value, "otro")}
                className="w-40"
              />
            )}
          </div>
        </div>
        <Campo id={`quien-${tipo}`} etiqueta={ETIQUETA_QUIEN[tipo]} className="w-56">
          <Lista value={quien} onChange={(e) => void cambiarQuien(e.target.value)}>
            {tipo === "descuento" ? <option value="">Elige un vendedor…</option> : <option value={QUIEN_OFICINA}>Oficina</option>}
            {opcionesQuien.map((v) => (
              <option key={v.id} value={v.id}>
                {v.nombre}
              </option>
            ))}
          </Lista>
        </Campo>
      </div>

      {editando && (
        <Aviso tono="informacion">
          {`Corrigiendo el registro de las ${editando.hora}${editando.cliente ? ` de ${editando.cliente.nombre}` : ""}.`}
        </Aviso>
      )}

      {sinCliente ? (
        <p className="rounded-[10px] border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">Elige un cliente arriba.</p>
      ) : (
        <>
          {avisoPrecarga && <Aviso tono="advertencia">{avisoPrecarga}</Aviso>}
          {dosCajas ? (
            <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-start gap-4">
              <CajaProductos titulo={titulos.recibido!} tono="recibido" renglones={recibido} opciones={opciones} onCambio={setRecibido} disabled={guardando} />
              <ArrowRight aria-hidden className="mt-16 size-5 text-muted-foreground" />
              <CajaProductos titulo={titulos.entregado!} tono="entregado" renglones={entregado} opciones={opciones} onCambio={setEntregado} disabled={guardando} />
            </div>
          ) : titulos.recibido ? (
            <div className="max-w-xl">
              <CajaProductos titulo={titulos.recibido} tono="recibido" renglones={recibido} opciones={opciones} onCambio={setRecibido} disabled={guardando} />
            </div>
          ) : (
            <div className="max-w-xl">
              <CajaProductos titulo={titulos.entregado!} tono="neutro" renglones={entregado} opciones={opciones} onCambio={setEntregado} disabled={guardando} />
            </div>
          )}

          {dosCajas && barra.recibido + barra.entregado > 0 && <BarraCuadre texto={barra.texto} cuadra={barra.cuadra} recibido={barra.recibido} entregado={barra.entregado} />}
          {hayMalEscritas && <Aviso tono="error">Las piezas son números enteros de 1 a 100000.</Aviso>}
          {error && <Aviso tono="error">{error}</Aviso>}

          <div className="flex items-center gap-3">
            <Entrada
              aria-label="Comentario"
              placeholder="Comentario (opcional)"
              maxLength={MAX_COMENTARIO_PROCESO}
              value={comentario}
              onChange={(e) => setComentario(e.target.value)}
              className="min-w-0 flex-1"
            />
            {editando ? (
              <Button type="button" variant="outline" onClick={onCancelar} disabled={guardando}>
                Cancelar
              </Button>
            ) : (
              <Button type="button" variant="outline" onClick={limpiar} disabled={guardando}>
                Limpiar
              </Button>
            )}
            <Button type="button" disabled={!puedeGuardar} onClick={() => void guardar()}>
              {guardando ? "Guardando…" : editando ? "Guardar cambios" : info.guardar}
            </Button>
          </div>
        </>
      )}
      {ventana}
    </div>
  );
}

function BarraCuadre({ texto, cuadra, recibido, entregado }: { texto: string; cuadra: boolean; recibido: number; entregado: number }) {
  const avance = recibido === 0 ? 1 : Math.min(entregado / recibido, 1);
  return (
    <div
      role="status"
      className={cn(
        "flex items-center gap-4 rounded-[10px] px-4 py-3 text-sm",
        cuadra ? "bg-success-soft text-success" : "bg-warning-soft text-warning",
      )}
    >
      <span className="min-w-0 flex-1 font-medium">{texto}</span>
      <span aria-hidden className="h-1.5 w-48 shrink-0 overflow-hidden rounded-full bg-background">
        <span className="block h-full rounded-full bg-current" style={{ width: `${Math.round(avance * 100)}%` }} />
      </span>
    </div>
  );
}
