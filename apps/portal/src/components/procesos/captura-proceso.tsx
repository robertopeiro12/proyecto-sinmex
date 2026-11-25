"use client";

import { useEffect, useRef, useState } from "react";
import { Aviso } from "@/components/ui/aviso";
import { Button } from "@/components/ui/button";
import { useConfirmar } from "@/components/ui/confirmar";
import { Entrada, Lista } from "@/components/ui/campo";
import { SelectorSegmentado } from "@/components/ui/selector-segmentado";
import { mensajeDe } from "@/lib/api";
import { diaAnterior } from "@/lib/fechas";
import { diaEscrito } from "@/lib/formato";
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
  merma: "Recogió",
  cambio: "Quién",
  consumo: "Quién",
  promocion: "Quién",
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

/**
 * La captura de una pestaña de Procesos (D1, boceto 2): una fila compacta de opciones, las
 * cajas de productos (dos tablas lado a lado en Merma de cliente y Cambios) y una fila con
 * comentario, el cuadre en texto corto y Guardar. Con `editando`, carga ese registro y guarda
 * con "Guardar cambios" / "Cancelar" (Cancelar es la forma de soltarlo; no hay "Limpiar"). Quien la
 * monta le pone `key` por registro: lo escrito vive aquí y se pierde al cambiar de key.
 */
export function CapturaProceso({
  tipo,
  sucursal,
  hoy,
  cliente,
  fecha,
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
  avisoQuien = null,
}: {
  tipo: TipoProceso;
  sucursal: string;
  hoy: string;
  /** El cliente elegido arriba (o el del registro que se corrige). */
  cliente: { id: string; nombre: string } | null;
  fecha: string;
  onFecha: (fecha: string) => void;
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
  /** Aviso informativo bajo la fila de opciones (Descuentos: ya hay uno de ese vendedor ese día). */
  avisoQuien?: string | null;
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
  // Descuentos: hay una precarga en camino (no se guarda ni se toca la caja hasta que llegue).
  const [precargando, setPrecargando] = useState(false);
  const precargaVigente = useRef(0);
  // Lo último que precargó Descuentos: si la caja sigue igual, no hay nada escrito a mano.
  const [precargado, setPrecargado] = useState<RenglonCaja[]>([]);
  const { confirmar, ventana } = useConfirmar();

  const sucio = editando !== null || recibido.length > 0 || entregado.length > 0 || comentario.trim() !== "";
  useEffect(() => {
    onSucio(sucio);
  }, [sucio, onSucio]);
  useEffect(() => () => onSucio(false), [onSucio]);

  /**
   * Descuentos (R3): al elegir vendedor o día se precargan los faltantes del corte. La caja
   * se vacía ANTES de pedirlos y se queda vacía si la consulta falla: nunca quedan las piezas
   * de otro vendedor o día bajo el elegido (un descuento se le cobra a esa persona). Una
   * respuesta que llega tarde, de una elección anterior, se ignora.
   */
  async function precargar(vendedor: string, dia: string) {
    const esta = ++precargaVigente.current;
    setAvisoPrecarga(null);
    if (tipo !== "descuento" || editando || dia === "") return;
    setEntregado([]);
    setPrecargado([]);
    setError(null);
    if (vendedor === "") {
      setPrecargando(false);
      return;
    }
    setPrecargando(true);
    try {
      const r = await precargaDescuentos(vendedor, dia);
      if (esta !== precargaVigente.current) return;
      const renglones = r.lineas.map((l) => renglonDe(l, opciones));
      setEntregado(renglones);
      setPrecargado(renglones);
      if (!r.corteHecho) setAvisoPrecarga("Ese día no tiene corte hecho: no hay faltantes que precargar.");
      else if (r.lineas.length === 0) setAvisoPrecarga("Ese día no le faltó ninguna pieza.");
    } catch (err) {
      if (esta !== precargaVigente.current) return;
      setError(mensajeDe(err, "No se pudieron precargar los faltantes."));
    } finally {
      if (esta === precargaVigente.current) setPrecargando(false);
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

  async function cambiarFecha(dia: string) {
    if (dia === "" || dia > hoy) return;
    // El mismo día (p. ej. "Hoy" cuando ya es hoy) no vuelve a precargar.
    // Sin vendedor no hay corte que precargar: la caja se queda como está.
    if (dia === fecha || quien === "") {
      onFecha(dia);
      return;
    }
    if (!(await soltarCajaDescuento())) return;
    onFecha(dia);
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
    !precargando &&
    !sinCliente &&
    todas.length > 0 &&
    !hayInvalidas &&
    cuadraBien &&
    !(tipo === "descuento" && quien === "") &&
    fecha !== "" &&
    fecha <= hoy;

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

  const quienId = `quien-${tipo}`;
  const diaId = `dia-${tipo}`;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        {tipo === "merma" && (
          <SelectorSegmentado
            etiqueta="Merma de"
            resaltado
            valor={mermaDe}
            onCambio={(m) => void cambiarMermaDe(m)}
            opciones={[
              { valor: "cliente", texto: "De este cliente" },
              { valor: "almacen", texto: "De almacén" },
            ]}
          />
        )}
        {/* El día como en las demás pantallas (Registro de Operación): campo + atajos Hoy · Ayer. */}
        <div className="flex items-center gap-2">
          <label htmlFor={diaId} className="text-sm text-muted-foreground">
            Día
          </label>
          <Entrada id={diaId} type="date" required max={hoy} value={fecha} onChange={(e) => void cambiarFecha(e.target.value)} className="w-40" />
          <div role="group" aria-label="Atajos de día" className="flex items-center gap-0.5">
            <Button type="button" variant="ghost" size="sm" onClick={() => void cambiarFecha(hoy)}>
              Hoy
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => void cambiarFecha(diaAnterior(hoy))}>
              Ayer
            </Button>
          </div>
          <span className="text-sm text-muted-foreground">{diaEscrito(fecha, hoy)}</span>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor={quienId} className="text-sm text-muted-foreground">
            {ETIQUETA_QUIEN[tipo]}
          </label>
          <Lista id={quienId} value={quien} onChange={(e) => void cambiarQuien(e.target.value)} className="w-40">
            {tipo === "descuento" ? <option value="">Elige un vendedor…</option> : <option value={QUIEN_OFICINA}>Oficina</option>}
            {opcionesQuien.map((v) => (
              <option key={v.id} value={v.id}>
                {v.nombre}
              </option>
            ))}
          </Lista>
        </div>
      </div>

      {avisoQuien && <Aviso tono="informacion">{avisoQuien}</Aviso>}

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
            <div className="grid grid-cols-2 items-start gap-6">
              <CajaProductos titulo={titulos.recibido!} renglones={recibido} opciones={opciones} onCambio={setRecibido} disabled={guardando} />
              <CajaProductos titulo={titulos.entregado!} renglones={entregado} opciones={opciones} onCambio={setEntregado} disabled={guardando} />
            </div>
          ) : titulos.recibido ? (
            <div className="max-w-xl">
              <CajaProductos titulo={titulos.recibido} renglones={recibido} opciones={opciones} onCambio={setRecibido} disabled={guardando} />
            </div>
          ) : (
            <div className="max-w-xl">
              <CajaProductos titulo={titulos.entregado!} renglones={entregado} opciones={opciones} onCambio={setEntregado} disabled={guardando || precargando} />
            </div>
          )}

          {hayMalEscritas && <Aviso tono="error">Las piezas son números enteros de 1 a 100000.</Aviso>}
          {error && <Aviso tono="error">{error}</Aviso>}

          <div className="flex items-center gap-4">
            <Entrada
              aria-label="Comentario"
              placeholder="Comentario (opcional)"
              maxLength={MAX_COMENTARIO_PROCESO}
              value={comentario}
              onChange={(e) => setComentario(e.target.value)}
              className="h-10 min-w-0 flex-1"
            />
            {dosCajas && barra.recibido + barra.entregado > 0 && (
              <p role="status" className={cn("shrink-0 text-sm font-semibold whitespace-nowrap", barra.cuadra ? "text-success" : "text-warning")}>
                {barra.texto}
              </p>
            )}
            {editando && (
              <Button type="button" variant="outline" className="h-10 px-4" onClick={onCancelar} disabled={guardando}>
                Cancelar
              </Button>
            )}
            <Button type="button" className="h-10 px-5 font-semibold" disabled={!puedeGuardar} onClick={() => void guardar()}>
              {guardando ? "Guardando…" : editando ? "Guardar cambios" : info.guardar}
            </Button>
          </div>
        </>
      )}
      {ventana}
    </div>
  );
}
