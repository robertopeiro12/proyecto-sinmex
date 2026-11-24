"use client";

import { Fragment, useEffect, useState } from "react";
import { Aviso } from "@/components/ui/aviso";
import { Button } from "@/components/ui/button";
import { Campo, Entrada, Lista } from "@/components/ui/campo";
import { useConfirmar } from "@/components/ui/confirmar";
import {
  EncabezadoPantalla,
  Pantalla,
} from "@/components/ui/encabezado-pantalla";
import { EstadoPantalla } from "@/components/ui/estado-pantalla";
import { Ayuda } from "@/components/ui/ayuda";
import { Etiqueta } from "@/components/ui/etiqueta";
import {
  CajaTabla,
  Fila,
  FilaGrupo,
  FilaTotal,
  FilaVacia,
  Tabla,
  Td,
  Th,
} from "@/components/ui/tabla";
import { mensajeDe } from "@/lib/api";
import {
  borradorDeCorte,
  conteosDe,
  estadoDeCorte,
  etiquetaEstadoCorte,
  guardarCorteVendedor,
  leerCorteVendedor,
  lineaAgregada,
  presentacionesParaAgregar,
  vistaCorte,
  type BorradorCorte,
  type CorteVendedor as Corte,
  type LineaCorte,
  textoHecho,
  fraseFaltan,
} from "@/lib/cortes";
import { formatearDiaLargo } from "@/lib/formato";
import { listarProductos, type Producto } from "@/lib/productos";

const COLUMNAS = 7;
// Línea vertical que separa el bloque de producto terminado del de merma (y del producto).
const SEPARADOR = "border-l-2 border-l-foreground/20";
const TITULO_BLOQUE = "text-xs font-semibold uppercase tracking-wide text-foreground";

/**
 * El corte de un vendedor y un día (pantalla completa, como editar una venta). Los campos
 * traen lo ya guardado y vacío si no hay: nunca el teórico, para que sea un conteo real y
 * no un "aceptar". Guardar manda todas las líneas (vacío = 0) y deja el corte hecho.
 */
export function CorteVendedor({
  fecha,
  vendedor,
  onVolver,
}: {
  fecha: string;
  vendedor: { id: string; nombre: string };
  onVolver: () => void;
}) {
  const [corte, setCorte] = useState<Corte | null>(null);
  // Las presentaciones agregadas a mano que el servidor todavía no devuelve.
  const [agregadas, setAgregadas] = useState<LineaCorte[]>([]);
  const [borrador, setBorrador] = useState<BorradorCorte>({});
  // Renglones que el almacenista tocó en esta captura: sin corte hecho, solo ellos muestran faltante (D9).
  const [tocadas, setTocadas] = useState<ReadonlySet<string>>(() => new Set());
  const [productos, setProductos] = useState<Producto[]>([]);
  const [porAgregar, setPorAgregar] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const { confirmar, ventana } = useConfirmar();

  useEffect(() => {
    let vigente = true;
    leerCorteVendedor(fecha, vendedor.id)
      .then((r) => {
        if (!vigente) return;
        setCorte(r);
        setBorrador(borradorDeCorte(r.lineas));
      })
      .catch((err: unknown) => {
        if (vigente) setError(mensajeDe(err, "No se pudo cargar el corte."));
      });
    listarProductos().then(
      (lista) => {
        if (vigente) setProductos(lista);
      },
      () => {
        // Sin catálogo no se ofrece "Agregar presentación"; el corte sigue sirviendo.
      },
    );
    return () => {
      vigente = false;
    };
  }, [fecha, vendedor.id]);

  const lineas = [...(corte?.lineas ?? []), ...agregadas];
  const vista = vistaCorte(lineas, borrador, corte?.hecho != null, tocadas);
  const opciones = presentacionesParaAgregar(productos, lineas);
  // La pastilla dice lo guardado (como la lista), no lo que se va escribiendo.
  const estado = etiquetaEstadoCorte(
    corte
      ? estadoDeCorte(corte)
      : { estado: "sin_corte", piezasFaltantes: null, mermaFaltante: null },
  );

  function editar(id: string, campo: "buenas" | "merma", valor: string) {
    setAviso(null);
    setBorrador((prev) => ({
      ...prev,
      [id]: { ...(prev[id] ?? { buenas: "", merma: "" }), [campo]: valor },
    }));
    setTocadas((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
  }

  function agregar() {
    const elegida = opciones.find((o) => o.id === porAgregar);
    if (!elegida) return;
    setAgregadas((prev) => [
      ...prev,
      lineaAgregada(elegida.id, elegida.producto, elegida.volumen),
    ]);
    setPorAgregar("");
  }

  async function salir() {
    if (vista.cambios) {
      const si = await confirmar({
        titulo: "¿Descartar los cambios?",
        descripcion: "Lo que escribiste en este corte no se ha guardado.",
        confirmar: "Descartar",
      });
      if (!si) return;
    }
    onVolver();
  }

  async function guardar() {
    if (vista.sinPiezas) {
      const si = await confirmar({
        titulo: "¿El vendedor no regresó ninguna pieza?",
        descripcion: "El corte quedará hecho con 0 piezas buenas y 0 de merma.",
        confirmar: "Guardar corte",
        tono: "normal",
      });
      if (!si) return;
    }
    setGuardando(true);
    setError(null);
    setAviso(null);
    try {
      const r = await guardarCorteVendedor({
        fecha,
        vendedor: vendedor.id,
        lineas: conteosDe(vista),
      });
      setCorte(r);
      setAgregadas([]);
      setTocadas(new Set());
      setBorrador(borradorDeCorte(r.lineas));
      setAviso("Corte guardado.");
    } catch (err) {
      setError(
        mensajeDe(err, "No se pudo guardar el corte. Vuelve a intentar."),
      );
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Pantalla key="corte">
      <EncabezadoPantalla
        titulo={`Corte · ${vendedor.nombre}`}
        descripcion={`${formatearDiaLargo(fecha)}. Cuenta lo que regresó y anota las piezas buenas y la merma de cada producto.`}
        acciones={
          <Button
            type="button"
            variant="outline"
            disabled={guardando}
            onClick={() => void salir()}
          >
            ← Volver a Corte
          </Button>
        }
      />

      {error && <Aviso tono="error">{error}</Aviso>}
      {!corte && !error && <EstadoPantalla tipo="cargando" />}

      {corte && (
        <>
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Etiqueta tono={estado.tono}>{estado.texto}</Etiqueta>
            {corte.hecho && textoHecho(corte.hecho)}
          </p>

          <CajaTabla>
            <Tabla
              aria-label="Corte del vendedor"
              className="table-fixed min-w-[900px]"
            >
              {/* Producto proporcional y los números se reparten el resto: crece toda la tabla. */}
              <colgroup>
                <col className="w-[22%]" />
                {[1, 2, 3, 4, 5, 6].map((n) => (
                  <col key={n} />
                ))}
              </colgroup>
              <thead>
                <tr>
                  <Th rowSpan={2} className="align-bottom">
                    Producto
                  </Th>
                  <Th colSpan={3} alinear="centro" className={`${SEPARADOR} ${TITULO_BLOQUE}`}>
                    Producto terminado
                  </Th>
                  <Th colSpan={3} alinear="centro" className={`${SEPARADOR} ${TITULO_BLOQUE}`}>
                    Merma
                  </Th>
                </tr>
                <tr>
                  <Th alinear="derecha" className={`top-[32px] whitespace-normal ${SEPARADOR}`}>
                    Piezas teóricas por regresar
                    <Ayuda
                      tema="Piezas teóricas por regresar"
                      texto="Cargadas − vendidas − promoción − merma entregada al cliente − merma de almacén − consumo − cambios entregados + cambios recibidos."
                    />
                  </Th>
                  <Th alinear="derecha" className="top-[32px] whitespace-normal">
                    Piezas reales retornadas
                  </Th>
                  <Th alinear="derecha" className="top-[32px]">
                    Resultado
                  </Th>
                  <Th alinear="derecha" className={`top-[32px] whitespace-normal ${SEPARADOR}`}>
                    Merma teórica por regresar
                    <Ayuda
                      tema="Merma teórica por regresar"
                      texto="Merma recibida del cliente + merma de almacén."
                    />
                  </Th>
                  <Th alinear="derecha" className="top-[32px] whitespace-normal">
                    Merma real validada
                  </Th>
                  <Th alinear="derecha" className="top-[32px]">
                    Resultado
                  </Th>
                </tr>
              </thead>
              <tbody>
                {vista.filas.length === 0 && (
                  <FilaVacia columnas={COLUMNAS}>
                    No hubo carga ni venta ese día. Si regresó algo, agrega la
                    presentación.
                  </FilaVacia>
                )}
                {vista.grupos.map((g) => (
                  <Fragment key={g.tamano}>
                    <FilaGrupo columnas={COLUMNAS}>{g.tamano}</FilaGrupo>
                    {g.filas.map((f) => {
                      const l = f.linea;
                      return (
                        <Fila key={l.presentacionId} className="align-middle">
                          <Td>
                            <span className="block truncate">{l.producto}</span>
                            {l.deberiaRegresar < 0 && (
                              <span className="block text-xs font-medium text-warning">
                                Salió más de lo cargado
                              </span>
                            )}
                          </Td>
                          <Td alinear="derecha" className={SEPARADOR}>{l.deberiaRegresar}</Td>
                          <Td alinear="derecha">
                            <CampoConteo
                              etiqueta={`Piezas reales de ${l.nombre}`}
                              valor={borrador[l.presentacionId]?.buenas ?? ""}
                              invalido={f.buenas === null}
                              deshabilitado={guardando}
                              onCambio={(v) =>
                                editar(l.presentacionId, "buenas", v)
                              }
                            />
                          </Td>
                          <Td alinear="derecha">
                            <Resultado valor={f.faltante} />
                          </Td>
                          <Td alinear="derecha" className={SEPARADOR}>{l.mermaTeorica}</Td>
                          <Td alinear="derecha">
                            <CampoConteo
                              etiqueta={`Merma real de ${l.nombre}`}
                              valor={borrador[l.presentacionId]?.merma ?? ""}
                              invalido={f.merma === null}
                              deshabilitado={guardando}
                              onCambio={(v) =>
                                editar(l.presentacionId, "merma", v)
                              }
                            />
                          </Td>
                          <Td alinear="derecha">
                            <Resultado valor={f.resultadoMerma} />
                          </Td>
                        </Fila>
                      );
                    })}
                    <FilaTotal>
                      <Td>{`Total ${g.tamano}`}</Td>
                      <Td alinear="derecha" className={SEPARADOR}>{g.totales.deberiaRegresar}</Td>
                      <Td alinear="derecha">{g.totales.buenas}</Td>
                      <Td alinear="derecha">
                        <Resultado valor={g.totales.faltante} />
                      </Td>
                      <Td alinear="derecha" className={SEPARADOR}>{g.totales.mermaTeorica}</Td>
                      <Td alinear="derecha">{g.totales.merma}</Td>
                      <Td alinear="derecha">
                        <Resultado valor={g.totales.resultadoMerma} />
                      </Td>
                    </FilaTotal>
                  </Fragment>
                ))}
              </tbody>
              {vista.filas.length > 0 && (
                <tfoot>
                  {/* Suma por tamaño solo lo que falta (un sobrante no tapa un faltante): no es la suma de los resultados. */}
                  <FilaTotal>
                    <Td>Faltantes del día</Td>
                    <Td colSpan={3} alinear="derecha" className={`${SEPARADOR} whitespace-nowrap`}>
                      {(vista.totales.faltante ?? 0) > 0 && (
                        <span className="text-destructive">{fraseFaltan(vista.totales.faltante ?? 0, 0)}</span>
                      )}
                    </Td>
                    <Td colSpan={3} alinear="derecha" className={`${SEPARADOR} whitespace-nowrap`}>
                      {(vista.totales.faltanteMerma ?? 0) > 0 && (
                        <span className="text-destructive">{fraseFaltan(0, vista.totales.faltanteMerma ?? 0)}</span>
                      )}
                    </Td>
                  </FilaTotal>
                </tfoot>
              )}
            </Tabla>
          </CajaTabla>

          {opciones.length > 0 && (
            <div className="flex flex-wrap items-end gap-3">
              <Campo
                id="corte-agregar"
                etiqueta="Agregar presentación"
                className="w-72"
              >
                <Lista
                  value={porAgregar}
                  disabled={guardando}
                  onChange={(e) => setPorAgregar(e.target.value)}
                >
                  <option value="">Elige una presentación</option>
                  {opciones.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.nombre}
                    </option>
                  ))}
                </Lista>
              </Campo>
              <Button
                type="button"
                variant="outline"
                disabled={!porAgregar || guardando}
                onClick={agregar}
              >
                Agregar
              </Button>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <Button
              disabled={guardando || vista.hayInvalidas}
              onClick={() => void guardar()}
            >
              {guardando ? "Guardando…" : "Guardar corte"}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={guardando}
              onClick={() => void salir()}
            >
              Cancelar
            </Button>
            {aviso && <Aviso tono="exito">{aviso}</Aviso>}
          </div>
        </>
      )}
      {ventana}
    </Pantalla>
  );
}

function CampoConteo({
  etiqueta,
  valor,
  invalido,
  deshabilitado,
  onCambio,
}: {
  etiqueta: string;
  valor: string;
  invalido: boolean;
  deshabilitado: boolean;
  onCambio: (valor: string) => void;
}) {
  return (
    <>
      <Entrada
        aria-label={etiqueta}
        inputMode="numeric"
        aria-invalid={invalido || undefined}
        value={valor}
        disabled={deshabilitado}
        onChange={(e) => onCambio(e.target.value)}
        className="w-full text-right tabular-nums"
      />
      {invalido && (
        <p className="mt-1 text-xs text-destructive">Solo piezas enteras</p>
      )}
    </>
  );
}

/** > 0 falta: rojo y negrita; < 0 sobra: el número con signo en gris; 0 "0"; `null` vacío. */
function Resultado({ valor }: { valor: number | null }) {
  if (valor === null) return null;
  if (valor > 0)
    return <span className="font-semibold text-destructive">{valor}</span>;
  return <span className="text-muted-foreground">{valor}</span>;
}
