"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { Aviso } from "@/components/ui/aviso";
import { Button } from "@/components/ui/button";
import { useConfirmar } from "@/components/ui/confirmar";
import { Etiqueta, type TonoEtiqueta } from "@/components/ui/etiqueta";
import { EstadoPantalla } from "@/components/ui/estado-pantalla";
import { CajaTabla, FilaGrupo, Tabla } from "@/components/ui/tabla";
import { ErrorApi, mensajeDe } from "@/lib/api";
import {
  borradorDe,
  crearCarga,
  editarCarga,
  eliminarCarga,
  ETIQUETA_ESTADO,
  leerBorrador,
  MAX_PIEZAS_LINEA,
  obtenerRejilla,
  totalBorrador,
  totalPiezas,
  type Borrador,
  type CargaRejilla,
  type EstadoCarga,
  type PresentacionRejilla,
  type Rejilla,
  type VendedorRejilla,
} from "@/lib/cargas";
import { claveTamano, compararTamano } from "@/lib/cortes";
import { listarSucursales } from "@/lib/sucursales";
import { cn } from "@/lib/utils";
import { hoyEnTijuana } from "@/lib/ventas";

const TONO: Record<EstadoCarga, TonoEtiqueta> = { pendiente: "advertencia", aceptada: "exito", rechazada: "error" };

/** Vacío o 0 = sin línea (como `leerBorrador`); si no, un entero de 1 a MAX_PIEZAS_LINEA. */
function textoValido(texto: string): boolean {
  const limpio = texto.trim();
  if (limpio === "" || /^0+$/.test(limpio)) return true;
  return /^\d+$/.test(limpio) && Number(limpio) >= 1 && Number(limpio) <= MAX_PIEZAS_LINEA;
}

const hayInvalidos = (b: Borrador) => Object.values(b).some((t) => !textoValido(t));
/** Algo que sí sería línea (un 0 o un vacío no cuentan). */
const hayAlgo = (b: Borrador | undefined) => Object.values(b ?? {}).some((t) => t.trim() !== "" && !/^0+$/.test(t.trim()));

interface GrupoTamano {
  tamano: string;
  presentaciones: PresentacionRejilla[];
}

/**
 * Renglones: por tamaño (de menor a mayor) y, dentro, por nombre de producto. Una
 * presentación dada de baja solo llega si una carga de hoy la trae: sale para que no se
 * pierdan sus piezas, pero sin campo para capturar.
 */
function gruposDe(presentaciones: readonly PresentacionRejilla[]): GrupoTamano[] {
  const grupos = new Map<string, GrupoTamano>();
  for (const p of presentaciones) {
    const clave = claveTamano(p.volumen);
    const g = grupos.get(clave) ?? { tamano: p.volumen, presentaciones: [] };
    g.presentaciones.push(p);
    grupos.set(clave, g);
  }
  return [...grupos.values()]
    .sort((a, b) => compararTamano(a.tamano, b.tamano))
    .map((g) => ({
      ...g,
      presentaciones: [...g.presentaciones].sort(
        (a, b) => Number(b.activa) - Number(a.activa) || a.productoNombre.localeCompare(b.productoNombre, "es"),
      ),
    }));
}

const nombreDe = (p: PresentacionRejilla) => `${p.productoNombre} ${p.volumen}`;

interface Edicion {
  vendedor: VendedorRejilla;
  carga: CargaRejilla;
  borrador: Borrador;
}

/*
 * Medidas (1366 px ≈ 1012 px de caja): la columna de producto mide 176 px (`w-44`) y cada
 * subcolumna 112 px (`w-28`); con más subcolumnas de las que caben, la rejilla se desplaza
 * de lado DENTRO de su caja, con los productos fijos a la izquierda (`sticky left-0`) y los
 * vendedores fijos arriba (`thead sticky top-0`). La página no se desplaza de lado.
 */
const FIJA = "sticky left-0 z-[2] w-44 min-w-44 max-w-44 border-r bg-background px-3 py-1 text-left font-normal";
const CELDA = "w-28 min-w-28 max-w-28 border-b border-l px-1.5 py-1 text-right tabular-nums";
const ENC = "border-b border-l bg-menu px-2 py-1.5 text-left align-top text-[12.5px] font-semibold text-muted-foreground";
const CAMPO =
  "h-8 w-full rounded-[6px] border border-input bg-background px-2 text-right text-sm tabular-nums outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20";

/**
 * Pestaña Recargas del Registro de Operación: la rejilla de HOY de la sucursal del menú
 * (productos × vendedores), como el portal viejo, con los nombres fijos. Cada vendedor
 * tiene una subcolumna por carga de hoy y una "Nueva" para capturar; TAB baja por la
 * columna del vendedor y al terminar pasa al siguiente.
 */
export function RejillaRecargas({
  sucursal,
  onPendientes,
}: {
  sucursal: string;
  /** Avisa si hay piezas escritas sin guardar (nuevas o una corrección abierta). */
  onPendientes?: (hay: boolean) => void;
}) {
  const [rejilla, setRejilla] = useState<Rejilla | null>(null);
  const [cargando, setCargando] = useState(true);
  const [vuelta, setVuelta] = useState(0);
  // Los mensajes NO se borran al recargar la rejilla: solo al empezar otra acción.
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [nuevas, setNuevas] = useState<Record<string, Borrador>>({});
  // Lo que no se guardó, por vendedor; el nombre va aparte por si deja de salir en la rejilla.
  const [erroresVendedor, setErroresVendedor] = useState<Record<string, { nombre: string; mensaje: string }>>({});
  const [edicion, setEdicion] = useState<Edicion | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const ultima = useRef(0);
  const campos = useRef(new Map<string, HTMLInputElement>());
  const caja = useRef<HTMLDivElement>(null);
  const [masDerecha, setMasDerecha] = useState(false);
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
        if (esta === ultima.current) setRejilla(r);
      })
      .catch((err: unknown) => {
        if (esta !== ultima.current) return;
        setRejilla(null);
        setError(mensajeDe(err, "No se pudo cargar las recargas de hoy."));
      })
      .finally(() => {
        if (esta === ultima.current) setCargando(false);
      });
  }, [sucursal, vuelta]);

  // Un vendedor que ya no sale (dado de baja, cambió de sucursal): lo escrito para él se tira.
  useEffect(() => {
    if (!rejilla) return;
    const ids = new Set(rejilla.vendedores.map((v) => v.id));
    setNuevas((n) => (Object.keys(n).every((id) => ids.has(id)) ? n : Object.fromEntries(Object.entries(n).filter(([id]) => ids.has(id)))));
  }, [rejilla]);

  const pendientes = Object.values(nuevas).some((b) => hayAlgo(b)) || edicion !== null;
  useEffect(() => {
    onPendientes?.(pendientes);
  }, [pendientes, onPendientes]);
  useEffect(() => {
    if (!pendientes) return;
    const avisar = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", avisar);
    return () => window.removeEventListener("beforeunload", avisar);
  }, [pendientes]);

  // La sombra de la orilla derecha: hay más vendedores si la caja aún se puede desplazar.
  const medirOrilla = useCallback(() => {
    const el = caja.current;
    if (!el) return;
    setMasDerecha(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
    // Lo fijo no tapa el campo al que se llega: el desplazamiento deja ese margen.
    const thead = el.querySelector("thead");
    const tfoot = el.querySelector("tfoot");
    const fija = el.querySelector("tbody th[scope=row]") as HTMLElement | null;
    el.style.scrollPaddingTop = `${thead?.offsetHeight ?? 0}px`;
    el.style.scrollPaddingBottom = `${tfoot?.offsetHeight ?? 0}px`;
    el.style.scrollPaddingLeft = `${fija?.offsetWidth ?? 0}px`;
  }, []);
  useEffect(() => {
    medirOrilla();
    window.addEventListener("resize", medirOrilla);
    return () => window.removeEventListener("resize", medirOrilla);
  }, [medirOrilla, rejilla, edicion]);

  const grupos = useMemo(() => gruposDe(rejilla?.presentaciones ?? []), [rejilla]);
  const activas = useMemo(() => grupos.flatMap((g) => g.presentaciones.filter((p) => p.activa)), [grupos]);

  // El orden de TAB: la columna editable de cada vendedor de arriba a abajo, vendedor por vendedor.
  const ordenCampos = useMemo(() => {
    if (!rejilla) return [];
    if (edicion) return activas.map((p) => claveCampo(edicion.carga.id, p.id));
    return rejilla.vendedores.flatMap((v) => activas.map((p) => claveCampo(`nueva-${v.id}`, p.id)));
  }, [rejilla, activas, edicion]);

  function alTeclear(e: KeyboardEvent<HTMLInputElement>, clave: string) {
    if (e.key !== "Tab" || e.altKey || e.ctrlKey || e.metaKey) return;
    const i = ordenCampos.indexOf(clave);
    const destino = ordenCampos[e.shiftKey ? i - 1 : i + 1];
    const campo = destino ? campos.current.get(destino) : undefined;
    if (i < 0 || !campo) return; // en la orilla, TAB sigue su camino normal
    e.preventDefault();
    campo.focus({ preventScroll: true });
    campo.select();
    // `nearest` respeta el scroll-padding de la caja: el campo no queda bajo lo fijo.
    campo.closest("td")?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }

  function registrarCampo(clave: string) {
    return (el: HTMLInputElement | null) => {
      if (el) campos.current.set(clave, el);
      else campos.current.delete(clave);
    };
  }

  useEnfocarEdicion(edicion?.carga.id ?? null, activas, campos);

  if (cargando && !rejilla) {
    return (
      <div className="flex flex-col gap-4">
        {error && <Aviso tono="error">{error}</Aviso>}
        <EstadoPantalla tipo="cargando" />
      </div>
    );
  }

  const vendedores = rejilla?.vendedores ?? [];
  const hayNuevas = vendedores.some((v) => hayAlgo(nuevas[v.id]));
  const visibles = new Set(vendedores.map((v) => v.id));
  const fallasVisibles = Object.keys(erroresVendedor).filter((id) => visibles.has(id)).length;
  const fallasOcultas = Object.entries(erroresVendedor).filter(([id]) => !visibles.has(id));
  const nuevasInvalidas = vendedores.some((v) => hayInvalidos(nuevas[v.id] ?? {}));
  const totalNuevas = vendedores.reduce((t, v) => t + totalBorrador(nuevas[v.id] ?? {}), 0);
  const puedeGuardar = !ocupado && edicion === null && hayNuevas && !nuevasInvalidas;

  function limpiarMensajes() {
    setError(null);
    setAviso(null);
  }

  async function guardarNuevas() {
    if (!rejilla) return;
    const porGuardar = rejilla.vendedores
      .map((v) => ({ vendedor: v, ...leerBorrador(nuevas[v.id] ?? {}) }))
      .filter((x) => x.error === null);
    if (porGuardar.length === 0) return;
    limpiarMensajes();
    setErroresVendedor({});
    setOcupado(true);
    const guardadas: string[] = [];
    const fallas: Record<string, { nombre: string; mensaje: string }> = {};
    // Una por una: si una falla, las demás siguen y cada vendedor se queda con su resultado.
    for (const { vendedor, lineas } of porGuardar) {
      try {
        const creada = await crearCarga({ vendedorId: vendedor.id, lineas });
        guardadas.push(`${vendedor.nombre} n.º ${creada.numero}`);
        setNuevas((n) => {
          const resto = { ...n };
          delete resto[vendedor.id];
          return resto;
        });
      } catch (err) {
        fallas[vendedor.id] = { nombre: vendedor.nombre, mensaje: mensajeDe(err, "No se pudo guardar la recarga.") };
      }
    }
    if (guardadas.length > 0) {
      setAviso(`${guardadas.length === 1 ? "Recarga guardada" : "Recargas guardadas"}: ${guardadas.join(", ")}.`);
    }
    setErroresVendedor(fallas);
    setOcupado(false);
    setVuelta((v) => v + 1);
  }

  async function descartar() {
    const si = await confirmar({
      titulo: "¿Descartar lo escrito?",
      descripcion: "Se borran las piezas que no has guardado.",
      confirmar: "Descartar lo escrito",
    });
    if (!si) return;
    setNuevas({});
    setErroresVendedor({});
  }

  function escribirNueva(vendedorId: string, presentacionId: string, texto: string) {
    setNuevas((n) => ({ ...n, [vendedorId]: { ...n[vendedorId], [presentacionId]: texto } }));
    setErroresVendedor((e) => {
      if (!(vendedorId in e)) return e;
      const resto = { ...e };
      delete resto[vendedorId];
      return resto;
    });
  }

  function empezarEdicion(vendedor: VendedorRejilla, carga: CargaRejilla) {
    limpiarMensajes();
    setEdicion({ vendedor, carga, borrador: borradorDe(carga, rejilla?.presentaciones) });
  }

  async function guardarEdicion() {
    if (!edicion) return;
    const { lineas, error: errorBorrador } = leerBorrador(edicion.borrador);
    if (errorBorrador !== null) {
      setError(errorBorrador);
      return;
    }
    const { vendedor, carga } = edicion;
    limpiarMensajes();
    setOcupado(true);
    try {
      await editarCarga(carga.id, { version: carga.version, lineas });
      setEdicion(null);
      setAviso(`Recarga n.º ${carga.numero} de ${vendedor.nombre} guardada.`);
      setVuelta((v) => v + 1);
    } catch (err) {
      setError(mensajeDe(err, "No se pudo guardar la recarga."));
      if (err instanceof ErrorApi && err.status === 409) {
        // Lo escrito ya no aplica a la carga actual: se suelta y se trae la de ahora.
        setEdicion(null);
        setVuelta((v) => v + 1);
      }
    } finally {
      setOcupado(false);
    }
  }

  async function eliminar(vendedor: VendedorRejilla, carga: CargaRejilla) {
    const si = await confirmar({
      titulo: `¿Eliminar la recarga n.º ${carga.numero} de ${vendedor.nombre}?`,
      descripcion: "No se puede deshacer.",
      confirmar: "Eliminar recarga",
    });
    if (!si) return;
    limpiarMensajes();
    setOcupado(true);
    try {
      await eliminarCarga(carga.id, carga.version);
      setAviso(`Recarga n.º ${carga.numero} de ${vendedor.nombre} eliminada.`);
      setVuelta((v) => v + 1);
    } catch (err) {
      setError(mensajeDe(err, "No se pudo eliminar la recarga."));
      if (err instanceof ErrorApi && err.status === 409) setVuelta((v) => v + 1);
    } finally {
      setOcupado(false);
    }
  }

  const bajasEnEdicion = edicion
    ? edicion.carga.lineas
        .map((l) => rejilla?.presentaciones.find((p) => p.id === l.presentacionId))
        .filter((p): p is PresentacionRejilla => p !== undefined && !p.activa)
    : [];
  const edicionInvalida = edicion !== null && (hayInvalidos(edicion.borrador) || !hayAlgo(edicion.borrador));
  const columnasTotales = 1 + vendedores.reduce((t, v) => t + v.cargas.length + 1, 0);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Solo se capturan recargas de hoy. Las de días anteriores se ven en Inventario por vendedor → Recargas.
      </p>

      {aviso && <Aviso tono="exito">{aviso}</Aviso>}
      {error && <Aviso tono="error">{error}</Aviso>}
      {(fallasVisibles > 0 || fallasOcultas.length > 0) && (
        <Aviso tono="error">
          {fallasVisibles > 0 && (
            <p>
              {fallasVisibles === 1
                ? "Una recarga no se guardó: su mensaje está en rojo bajo el nombre del vendedor."
                : `${fallasVisibles} recargas no se guardaron: sus mensajes están en rojo bajo el nombre de cada vendedor.`}
            </p>
          )}
          {fallasOcultas.map(([id, f]) => (
            <p key={id}>{`No se guardó la recarga de ${f.nombre}: ${f.mensaje} Ya no sale en la rejilla; lo escrito se descartó.`}</p>
          ))}
        </Aviso>
      )}
      {bajasEnEdicion.map((p) => (
        <Aviso key={p.id} tono="advertencia">{`${nombreDe(p)} ya no se vende; al guardar se quita de la recarga.`}</Aviso>
      ))}
      {rejilla && vendedores.length === 0 && <Aviso tono="informacion">Esta sucursal no tiene vendedores activos.</Aviso>}

      {rejilla && vendedores.length > 0 && (
        <>
          <div className="relative w-fit max-w-full">
          <CajaTabla ref={caja} onScroll={medirOrilla} altoMaximo="62vh" className={cn(cargando && "opacity-60")}>
            <Tabla aria-label="Recargas de hoy" densidad="compacta" className="w-max border-separate border-spacing-0">
              <thead className="sticky top-0 z-[3] bg-menu">
                <tr>
                  <th rowSpan={2} scope="col" className={cn(FIJA, "z-[4] border-b bg-menu align-bottom py-1.5 text-[12.5px] font-semibold text-muted-foreground")}>
                    Producto
                  </th>
                  {vendedores.map((v) => (
                    <th key={v.id} colSpan={v.cargas.length + 1} scope="colgroup" className={cn(ENC, "max-w-0 text-foreground")}>
                      {/* Pegado a la orilla de la columna de productos: el nombre no se sale de la vista. */}
                      <span className="sticky left-[11.5rem] inline-block max-w-full truncate align-top" title={v.nombre}>
                        {v.nombre}
                      </span>
                      {erroresVendedor[v.id] && (
                        <span className="mt-0.5 block text-[11px] font-normal whitespace-normal text-destructive">{erroresVendedor[v.id].mensaje}</span>
                      )}
                    </th>
                  ))}
                </tr>
                <tr>
                  {vendedores.map((v) => (
                    <Fragment key={v.id}>
                      {v.cargas.map((c) => (
                        <th key={c.id} scope="col" className={cn(ENC, "w-28 min-w-28 max-w-28 font-normal")}>
                          <EncabezadoCarga
                            vendedor={v}
                            carga={c}
                            editando={edicion?.carga.id === c.id}
                            bloqueado={ocupado || edicion !== null}
                            invalida={edicionInvalida}
                            ocupado={ocupado}
                            onEditar={() => empezarEdicion(v, c)}
                            onEliminar={() => void eliminar(v, c)}
                            onGuardar={() => void guardarEdicion()}
                            onCancelar={() => setEdicion(null)}
                          />
                        </th>
                      ))}
                      <th scope="col" className={cn(ENC, "w-28 min-w-28 max-w-28 align-bottom text-foreground")}>
                        Nueva
                      </th>
                    </Fragment>
                  ))}
                </tr>
              </thead>
              <tbody>
                {grupos.map((g) => (
                  <Fragment key={claveTamano(g.tamano)}>
                    <FilaGrupo columnas={columnasTotales}>
                      <span className="sticky left-3 inline-block">{g.tamano}</span>
                    </FilaGrupo>
                    {g.presentaciones.map((p) => (
                      <tr key={p.id} className="hover:bg-menu/60">
                        <th scope="row" className={cn(FIJA, "border-b")}>
                          <span className={cn("block truncate", !p.activa && "text-muted-foreground")} title={nombreDe(p)}>
                            {p.productoNombre}
                            {!p.activa && <span className="text-xs"> · ya no se vende</span>}
                          </span>
                        </th>
                        {vendedores.map((v) => (
                          <Fragment key={v.id}>
                            {v.cargas.map((c) =>
                              edicion?.carga.id === c.id && p.activa ? (
                                <td key={c.id} className={cn(CELDA, "bg-warning-soft/40")}>
                                  <CampoPiezas
                                    etiqueta={`Piezas de ${nombreDe(p)} en la recarga n.º ${c.numero} de ${v.nombre}`}
                                    valor={edicion.borrador[p.id] ?? ""}
                                    deshabilitado={ocupado}
                                    referencia={registrarCampo(claveCampo(c.id, p.id))}
                                    onTeclear={(e) => alTeclear(e, claveCampo(c.id, p.id))}
                                    onCambio={(t) => setEdicion((ed) => ed && { ...ed, borrador: { ...ed.borrador, [p.id]: t } })}
                                  />
                                </td>
                              ) : (
                                <td key={c.id} className={cn(CELDA, "text-foreground", c.estado === "rechazada" && "bg-destructive-soft/40")}>
                                  {c.lineas.find((l) => l.presentacionId === p.id)?.piezas ?? ""}
                                </td>
                              ),
                            )}
                            <td className={cn(CELDA, "bg-menu/40")}>
                              {p.activa && (
                                <CampoPiezas
                                  etiqueta={`Piezas nuevas de ${nombreDe(p)} para ${v.nombre}`}
                                  valor={nuevas[v.id]?.[p.id] ?? ""}
                                  deshabilitado={ocupado || edicion !== null}
                                  referencia={registrarCampo(claveCampo(`nueva-${v.id}`, p.id))}
                                  onTeclear={(e) => alTeclear(e, claveCampo(`nueva-${v.id}`, p.id))}
                                  onCambio={(t) => escribirNueva(v.id, p.id, t)}
                                />
                              )}
                            </td>
                          </Fragment>
                        ))}
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
              <tfoot className="sticky bottom-0 z-[3] bg-menu">
                <tr>
                  <th scope="row" className={cn(FIJA, "z-[4] border-t bg-menu py-1.5 font-semibold")}>
                    Total
                  </th>
                  {vendedores.map((v) => (
                    <Fragment key={v.id}>
                      {v.cargas.map((c) => (
                        <td key={c.id} className={cn(CELDA, "border-t border-b-0 py-1.5 font-semibold")}>
                          {edicion?.carga.id === c.id ? totalBorrador(edicion.borrador) : totalPiezas(c.lineas)}
                        </td>
                      ))}
                      <td className={cn(CELDA, "border-t border-b-0 py-1.5 font-semibold")}>{totalBorrador(nuevas[v.id] ?? {})}</td>
                    </Fragment>
                  ))}
                </tr>
              </tfoot>
            </Tabla>
          </CajaTabla>
          {masDerecha && (
            <div
              aria-hidden
              data-testid="hay-mas-a-la-derecha"
              className="pointer-events-none absolute inset-y-px right-px w-6 rounded-r-[10px] bg-gradient-to-l from-foreground/15 to-transparent"
            />
          )}
          </div>

          {nuevasInvalidas && <Aviso tono="error">{`Las piezas son números enteros de 1 a ${MAX_PIEZAS_LINEA}. Corrige las casillas en rojo.`}</Aviso>}

          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" disabled={!puedeGuardar} onClick={() => void guardarNuevas()}>
              {ocupado && edicion === null ? "Guardando…" : "Guardar recarga"}
            </Button>
            <Button type="button" variant="outline" disabled={ocupado || !hayNuevas} onClick={() => void descartar()}>
              Descartar
            </Button>
            <span className="ml-2 text-sm text-muted-foreground">
              {edicion
                ? `Estás corrigiendo la recarga n.º ${edicion.carga.numero} de ${edicion.vendedor.nombre}: guárdala o cancélala para capturar las nuevas.`
                : `Nuevas: ${totalNuevas} piezas`}
            </span>
          </div>
        </>
      )}
      {ventana}
    </div>
  );
}

const claveCampo = (columna: string, presentacionId: string) => `${columna}|${presentacionId}`;

/** Al abrir una corrección, el cursor cae en su primer campo. */
function useEnfocarEdicion(
  cargaId: string | null,
  activas: readonly PresentacionRejilla[],
  campos: { current: Map<string, HTMLInputElement> },
) {
  const primera = activas[0]?.id;
  useEffect(() => {
    if (cargaId && primera) campos.current.get(claveCampo(cargaId, primera))?.focus();
  }, [cargaId, primera, campos]);
}

function CampoPiezas({
  etiqueta,
  valor,
  deshabilitado,
  referencia,
  onTeclear,
  onCambio,
}: {
  etiqueta: string;
  valor: string;
  deshabilitado: boolean;
  referencia: (el: HTMLInputElement | null) => void;
  onTeclear: (e: KeyboardEvent<HTMLInputElement>) => void;
  onCambio: (texto: string) => void;
}) {
  return (
    <input
      ref={referencia}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      aria-label={etiqueta}
      aria-invalid={!textoValido(valor) || undefined}
      className={CAMPO}
      disabled={deshabilitado}
      value={valor}
      onKeyDown={onTeclear}
      onChange={(e) => onCambio(e.target.value)}
    />
  );
}

function EncabezadoCarga({
  vendedor,
  carga,
  editando,
  bloqueado,
  invalida,
  ocupado,
  onEditar,
  onEliminar,
  onGuardar,
  onCancelar,
}: {
  vendedor: VendedorRejilla;
  carga: CargaRejilla;
  editando: boolean;
  bloqueado: boolean;
  invalida: boolean;
  ocupado: boolean;
  onEditar: () => void;
  onEliminar: () => void;
  onGuardar: () => void;
  onCancelar: () => void;
}) {
  const cual = `la recarga n.º ${carga.numero} de ${vendedor.nombre}`;
  return (
    <div className="flex flex-col items-start gap-1">
      <div className="flex w-full items-center justify-between gap-1">
        <span className="font-semibold text-foreground">{`n.º ${carga.numero}`}</span>
        {carga.estado !== "aceptada" && !editando && (
          <span className="flex gap-0.5">
            <Button type="button" size="icon-xs" variant="ghost" disabled={bloqueado} aria-label={`Editar ${cual}`} title="Editar" onClick={onEditar}>
              <Pencil aria-hidden />
            </Button>
            <Button type="button" size="icon-xs" variant="ghost" disabled={bloqueado} aria-label={`Eliminar ${cual}`} title="Eliminar" onClick={onEliminar}>
              <Trash2 aria-hidden />
            </Button>
          </span>
        )}
      </div>
      <Etiqueta tono={TONO[carga.estado]}>{ETIQUETA_ESTADO[carga.estado]}</Etiqueta>
      {carga.estado === "rechazada" && carga.motivoRechazo && (
        <span className="line-clamp-2 text-[11px] whitespace-normal text-destructive" title={carga.motivoRechazo}>
          {carga.motivoRechazo}
        </span>
      )}
      {editando && (
        <span className="flex gap-1">
          <Button type="button" size="xs" disabled={ocupado || invalida} aria-label={`Guardar ${cual}`} onClick={onGuardar}>
            {ocupado ? "…" : "Guardar"}
          </Button>
          <Button type="button" size="xs" variant="outline" disabled={ocupado} aria-label={`Cancelar la edición de ${cual}`} onClick={onCancelar}>
            Cancelar
          </Button>
        </span>
      )}
    </div>
  );
}
