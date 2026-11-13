"use client";

import { useEffect, useState } from "react";
import { Aviso } from "@/components/ui/aviso";
import { Button } from "@/components/ui/button";
import { Campo, Entrada, Lista } from "@/components/ui/campo";
import { useConfirmar } from "@/components/ui/confirmar";
import {
  EncabezadoPantalla,
  Pantalla,
} from "@/components/ui/encabezado-pantalla";
import { EstadoPantalla } from "@/components/ui/estado-pantalla";
import { Etiqueta } from "@/components/ui/etiqueta";
import {
  CajaTabla,
  Fila,
  FilaTotal,
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
} from "@/lib/cortes";
import { formatearDiaLargo } from "@/lib/formato";
import { listarProductos, type Producto } from "@/lib/productos";

const COLUMNAS = 8;
const LEYENDA =
  "Debería regresar = cargadas − vendidas − regaladas. La merma, los cambios y el consumo de la tablet se restarán cuando la app los registre.";

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
      : { estado: "sin_corte", piezasFaltantes: null },
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
      lineaAgregada(elegida.id, elegida.nombre),
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
        descripcion={`${formatearDiaLargo(fecha)}. Cuenta lo que regresó y anota las buenas y la merma de cada presentación.`}
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
              <colgroup>
                <col />
                <col className="w-24" />
                <col className="w-24" />
                <col className="w-24" />
                <col className="w-24" />
                <col className="w-28" />
                <col className="w-28" />
                <col className="w-28" />
              </colgroup>
              <thead>
                <tr>
                  <Th>Presentación</Th>
                  <Th alinear="derecha">Cargadas</Th>
                  <Th alinear="derecha">Vendidas</Th>
                  <Th alinear="derecha">Regaladas</Th>
                  <Th alinear="derecha" className="whitespace-normal">
                    Debería regresar
                  </Th>
                  <Th alinear="derecha">Buenas</Th>
                  <Th alinear="derecha">Merma</Th>
                  <Th alinear="derecha">Faltante</Th>
                </tr>
              </thead>
              <tbody>
                {vista.filas.length === 0 && (
                  <tr>
                    <td
                      colSpan={COLUMNAS}
                      className="px-3 py-6 text-center text-muted-foreground"
                    >
                      No hubo carga ni venta ese día. Si regresó algo, agrega la
                      presentación.
                    </td>
                  </tr>
                )}
                {vista.filas.map((f) => {
                  const l = f.linea;
                  return (
                    <Fila key={l.presentacionId} className="align-middle">
                      <Td>
                        <span className="block truncate">{l.nombre}</span>
                        {l.deberiaRegresar < 0 && (
                          <span className="block text-xs font-medium text-warning">
                            Vendió más de lo cargado
                          </span>
                        )}
                      </Td>
                      <Td alinear="derecha">{l.cargadas}</Td>
                      <Td alinear="derecha">{l.vendidas}</Td>
                      <Td alinear="derecha">{l.regaladas}</Td>
                      <Td alinear="derecha" className="font-semibold">
                        {l.deberiaRegresar}
                      </Td>
                      <Td alinear="derecha">
                        <CampoConteo
                          etiqueta={`Buenas de ${l.nombre}`}
                          valor={borrador[l.presentacionId]?.buenas ?? ""}
                          invalido={f.buenas === null}
                          deshabilitado={guardando}
                          onCambio={(v) =>
                            editar(l.presentacionId, "buenas", v)
                          }
                        />
                      </Td>
                      <Td alinear="derecha">
                        <CampoConteo
                          etiqueta={`Merma de ${l.nombre}`}
                          valor={borrador[l.presentacionId]?.merma ?? ""}
                          invalido={f.merma === null}
                          deshabilitado={guardando}
                          onCambio={(v) => editar(l.presentacionId, "merma", v)}
                        />
                      </Td>
                      <Td alinear="derecha">
                        <Faltante valor={f.faltante} />
                      </Td>
                    </Fila>
                  );
                })}
              </tbody>
              <tfoot>
                <FilaTotal>
                  <Td>Total</Td>
                  <Td alinear="derecha">{vista.totales.cargadas}</Td>
                  <Td alinear="derecha">{vista.totales.vendidas}</Td>
                  <Td alinear="derecha">{vista.totales.regaladas}</Td>
                  <Td alinear="derecha">{vista.totales.deberiaRegresar}</Td>
                  <Td alinear="derecha">{vista.totales.buenas}</Td>
                  <Td alinear="derecha">{vista.totales.merma}</Td>
                  {/* Suma solo lo que falta (un sobrante no tapa un faltante): no es Debería − Buenas. */}
                  <Td alinear="derecha" className="whitespace-nowrap">
                    {(vista.totales.faltante ?? 0) > 0 && (
                      <span className="text-destructive">{`Faltan ${vista.totales.faltante}`}</span>
                    )}
                  </Td>
                </FilaTotal>
              </tfoot>
            </Tabla>
          </CajaTabla>

          <p className="text-xs text-muted-foreground">{LEYENDA}</p>

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

/** > 0 en rojo; < 0 es sobrante, sin rojo; 0 nada; `null` (sin corte) nada. */
function Faltante({ valor }: { valor: number | null }) {
  if (valor === null || valor === 0) return null;
  if (valor > 0)
    return <span className="font-semibold text-destructive">{valor}</span>;
  return <span className="text-muted-foreground">{`Sobran ${-valor}`}</span>;
}
