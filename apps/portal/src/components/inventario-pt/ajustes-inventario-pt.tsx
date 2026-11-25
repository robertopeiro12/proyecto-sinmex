"use client";

import { Fragment, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Aviso } from "@/components/ui/aviso";
import { Button } from "@/components/ui/button";
import { AreaTexto, Campo, Entrada } from "@/components/ui/campo";
import { useConfirmar } from "@/components/ui/confirmar";
import { EncabezadoPantalla, Pantalla } from "@/components/ui/encabezado-pantalla";
import { Etiqueta } from "@/components/ui/etiqueta";
import { CajaTabla, Fila, FilaGrupo, FilaVacia, Tabla, Td, Th } from "@/components/ui/tabla";
import { mensajeDe } from "@/lib/api";
import { claveTamano } from "@/lib/cortes";
import { diaAnterior } from "@/lib/fechas";
import {
  agruparPorTamano,
  borrarAjustePt,
  cambiosDeAjuste,
  guardarAjustesPt,
  leerAjustesPt,
  MAX_COMENTARIO_AJUSTE,
  type CapturaAjuste,
  type RenglonAjustePt,
} from "@/lib/inventario-pt";
import { diaEscrito, plural } from "@/lib/formato";
import { TITULO } from "./tabla-inventario-pt";

type Columna = "inicial" | "merma";
const COLUMNAS: Columna[] = ["inicial", "merma"];
const texto = (n: number | null) => (n === null ? "" : String(n));

/**
 * D3, "borrón y cuenta nueva": la rejilla por tamaño (como Registro de Operación) con el
 * Inventario inicial y la Merma acumulada de un día, precargados con lo que calcula el
 * sistema. Solo se guardan los renglones cambiados; un renglón ya ajustado se puede quitar
 * (vuelve a encadenar desde el ajuste anterior). TAB baja por la columna, como Recargas.
 */
export function AjustesInventarioPt({
  sucursal,
  fechaInicial,
  hoy,
  onVolver,
  onGuardado,
  fijaEnHoy = false,
  volverA = TITULO,
}: {
  /** Código de UNA sucursal (con "Todas" no se ajusta). */
  sucursal: string;
  fechaInicial: string;
  hoy: string;
  onVolver: () => void;
  /** Guardó: el día que se ajustó. */
  onGuardado: (fecha: string) => void;
  /** Sin campo de día: siempre `hoy` (Inventario de PT con Recargas, D4). */
  fijaEnHoy?: boolean;
  /** La pantalla a la que regresa "← Volver a …". */
  volverA?: string;
}) {
  const [fecha, setFecha] = useState(fijaEnHoy || fechaInicial > hoy ? hoy : fechaInicial);
  const [precarga, setPrecarga] = useState<RenglonAjustePt[] | null>(null);
  const [captura, setCaptura] = useState<CapturaAjuste>({});
  const [comentario, setComentario] = useState("");
  const [version, setVersion] = useState(0);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const campos = useRef(new Map<string, HTMLInputElement>());
  const { confirmar, ventana } = useConfirmar();

  useEffect(() => {
    let vigente = true;
    leerAjustesPt(fecha, sucursal).then(
      (r) => {
        if (!vigente) return;
        setPrecarga(r.renglones);
        setError(null);
      },
      (err: unknown) => {
        if (!vigente) return;
        setPrecarga([]);
        setError(mensajeDe(err, "No se pudo cargar el inventario de ese día."));
      },
    );
    return () => {
      vigente = false;
    };
  }, [fecha, sucursal, version]);

  const grupos = useMemo(() => agruparPorTamano(precarga ?? []), [precarga]);
  const orden = useMemo(
    () => COLUMNAS.flatMap((c) => grupos.flatMap((g) => g.renglones.map((r) => `${c}|${r.presentacionId}`))),
    [grupos],
  );
  const { renglones: cambiados, invalidos, incompletos } = cambiosDeAjuste(precarga ?? [], captura);
  const comentarioLimpio = comentario.trim();
  const sucio = cambiados.length > 0 || invalidos.length > 0 || incompletos.length > 0 || comentarioLimpio !== "";
  const puedeGuardar = !ocupado && precarga !== null && cambiados.length > 0 && invalidos.length === 0 && incompletos.length === 0;

  async function soltar(): Promise<boolean> {
    if (!sucio) return true;
    return confirmar({
      titulo: "¿Descartar lo que escribiste?",
      descripcion: "El ajuste no se ha guardado y se pierde.",
      confirmar: "Descartar",
      tono: "normal",
    });
  }

  async function cambiarFecha(nueva: string) {
    if (nueva === "" || nueva > hoy || nueva === fecha) return;
    if (!(await soltar())) return;
    setCaptura({});
    setPrecarga(null);
    setFecha(nueva);
  }

  async function volver() {
    if (await soltar()) onVolver();
  }

  function valor(r: RenglonAjustePt, c: Columna): string {
    const escrito = captura[r.presentacionId];
    if (escrito) return escrito[c];
    return texto(c === "inicial" ? r.inventarioInicial : r.mermaAcumuladaInicial);
  }

  function escribir(r: RenglonAjustePt, c: Columna, t: string) {
    setCaptura((prev) => {
      const actual = prev[r.presentacionId] ?? {
        inicial: texto(r.inventarioInicial),
        merma: texto(r.mermaAcumuladaInicial),
      };
      return { ...prev, [r.presentacionId]: { ...actual, [c]: t } };
    });
  }

  function teclear(e: KeyboardEvent<HTMLInputElement>, clave: string) {
    if (e.key !== "Tab" || e.altKey || e.ctrlKey || e.metaKey) return;
    const i = orden.indexOf(clave);
    const destino = orden[e.shiftKey ? i - 1 : i + 1];
    const campo = destino ? campos.current.get(destino) : undefined;
    if (i < 0 || !campo) return; // en la orilla, TAB sigue su camino normal
    e.preventDefault();
    campo.focus({ preventScroll: true });
    campo.select();
    campo.closest("td")?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }

  async function guardar() {
    setOcupado(true);
    setError(null);
    try {
      await guardarAjustesPt({
        fecha,
        sucursal,
        comentario: comentarioLimpio === "" ? null : comentarioLimpio,
        renglones: cambiados,
      });
      onGuardado(fecha);
    } catch (err) {
      setError(mensajeDe(err, "No se pudo guardar el ajuste."));
      setOcupado(false);
    }
  }

  async function quitar(r: RenglonAjustePt) {
    const nombre = `${r.producto} ${r.volumen}`;
    const si = await confirmar({
      titulo: `¿Quitar el ajuste de ${nombre}?`,
      descripcion: "Ese día vuelve a calcularse desde el ajuste anterior. Lo que escribiste en los demás renglones se conserva.",
      confirmar: "Quitar ajuste",
    });
    if (!si) return;
    setOcupado(true);
    setError(null);
    try {
      await borrarAjustePt(fecha, sucursal, r.presentacionId);
      setCaptura((prev) => {
        const resto = { ...prev };
        delete resto[r.presentacionId];
        return resto;
      });
      setVersion((v) => v + 1);
    } catch (err) {
      setError(mensajeDe(err, "No se pudo quitar el ajuste."));
      setVersion((v) => v + 1);
    } finally {
      setOcupado(false);
    }
  }

  function entrada(r: RenglonAjustePt, c: Columna) {
    const clave = `${c}|${r.presentacionId}`;
    const nombre = `${r.producto} ${r.volumen}`;
    return (
      <Entrada
        ref={(el) => {
          if (el) campos.current.set(clave, el);
          else campos.current.delete(clave);
        }}
        type="text"
        inputMode="numeric"
        aria-label={`${c === "inicial" ? "Inventario inicial" : "Merma acumulada"} de ${nombre}`}
        aria-invalid={invalidos.includes(r.presentacionId) || undefined}
        className="w-28 text-right"
        value={valor(r, c)}
        onKeyDown={(e) => teclear(e, clave)}
        onChange={(e) => escribir(r, c, e.target.value)}
      />
    );
  }

  return (
    <Pantalla key="ajustes">
      <div>
        <Button type="button" variant="ghost" size="sm" onClick={() => void volver()}>
          ← Volver a {volverA}
        </Button>
      </div>
      <EncabezadoPantalla
        titulo="Ajustar inventario"
        descripcion={`Sucursal ${sucursal}. Con un conteo físico, captura el inventario y la merma acumulada con que arranca el día; de ahí en adelante se calcula.`}
      />

      <div className="flex flex-wrap items-start gap-4">
        {fijaEnHoy ? (
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Día</span>
            <span className="flex h-9 items-center text-sm text-muted-foreground">{diaEscrito(fecha, hoy)}</span>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="pt-ajuste-dia" className="text-sm font-medium">
              Día
            </label>
            <div className="flex items-center gap-2">
              <Entrada
                id="pt-ajuste-dia"
                type="date"
                required
                max={hoy}
                value={fecha}
                onChange={(e) => void cambiarFecha(e.target.value)}
                className="w-40"
              />
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
          </div>
        )}
        <Campo id="pt-ajuste-comentario" etiqueta="Comentario" opcional className="min-w-64 flex-1">
          <AreaTexto maxLength={MAX_COMENTARIO_AJUSTE} value={comentario} onChange={(e) => setComentario(e.target.value)} />
        </Campo>
      </div>

      <Aviso tono="informacion">
        Viene con lo que calcula el sistema para ese día. Cambia solo lo que contaste: se guardan nada más los renglones que cambies.
      </Aviso>
      {error && <Aviso tono="error">{error}</Aviso>}
      {invalidos.length > 0 && (
        <Aviso tono="error">Los números son enteros de 0 en adelante.</Aviso>
      )}

      {precarga === null ? (
        <p className="text-sm text-muted-foreground">Cargando…</p>
      ) : (
        <CajaTabla altoMaximo="55vh" className="max-w-3xl scroll-pt-10">
          <Tabla aria-label="Ajuste por presentación" className="table-fixed">
            <colgroup>
              <col />
              <col className="w-40" />
              <col className="w-40" />
              <col className="w-52" />
            </colgroup>
            <thead>
              <tr>
                <Th>Producto</Th>
                <Th alinear="derecha">Inventario inicial</Th>
                <Th alinear="derecha">Merma acumulada</Th>
                <Th>
                  <span className="sr-only">Ajuste</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {grupos.length === 0 && <FilaVacia columnas={4}>No hay presentaciones activas.</FilaVacia>}
              {grupos.map((g) => (
                <Fragment key={claveTamano(g.tamano)}>
                  <FilaGrupo columnas={4}>{g.tamano}</FilaGrupo>
                  {g.renglones.map((r) => (
                    <Fila key={r.presentacionId} className="align-middle">
                      <Td>{r.producto}</Td>
                      <Td>
                        <div className="flex justify-end">{entrada(r, "inicial")}</div>
                      </Td>
                      <Td>
                        <div className="flex justify-end">{entrada(r, "merma")}</div>
                      </Td>
                      <Td>
                        {r.ajustado && (
                          <span className="flex items-center gap-2">
                            <Etiqueta tono="informacion">Ajustado</Etiqueta>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              disabled={ocupado}
                              aria-label={`Quitar ajuste de ${r.producto} ${r.volumen}`}
                              onClick={() => void quitar(r)}
                            >
                              Quitar
                            </Button>
                          </span>
                        )}
                      </Td>
                    </Fila>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </Tabla>
        </CajaTabla>
      )}

      <div className="flex items-center gap-3">
        <Button type="button" disabled={!puedeGuardar} onClick={() => void guardar()}>
          Guardar ajuste
        </Button>
        <Button type="button" variant="outline" onClick={() => void volver()}>
          Cancelar
        </Button>
        {cambiados.length > 0 && (
          <span className="text-sm text-muted-foreground">
            {plural(cambiados.length, "renglón cambiado", "renglones cambiados")}
          </span>
        )}
        {incompletos.length > 0 && (
          <span className="text-sm text-warning">
            {`Captura los dos números en ${plural(incompletos.length, "renglón", "renglones")} para poder guardar.`}
          </span>
        )}
      </div>
      {ventana}
    </Pantalla>
  );
}
