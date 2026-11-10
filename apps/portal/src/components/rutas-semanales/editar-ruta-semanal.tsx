"use client";

import { useEffect, useMemo, useState } from "react";
import { CarteraRuta } from "@/components/rutas/cartera-ruta";
import { Aviso } from "@/components/ui/aviso";
import { Button } from "@/components/ui/button";
import { Campo, Entrada } from "@/components/ui/campo";
import { useConfirmar } from "@/components/ui/confirmar";
import { EncabezadoPantalla, Pantalla } from "@/components/ui/encabezado-pantalla";
import { EstadoPantalla } from "@/components/ui/estado-pantalla";
import { Etiqueta } from "@/components/ui/etiqueta";
import { mensajeDe } from "@/lib/api";
import { listarClientes, type ClienteResumen } from "@/lib/clientes";
import {
  guardarClientesRutaSemanal,
  obtenerRutaSemanal,
  renombrarRutaSemanal,
  type ClienteDeRutaSemanal,
  type RutaSemanalDetalle,
} from "@/lib/rutas-semanales";

import { confirmarYEliminarRuta } from "./eliminar-ruta";

const DIAS = ["", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

const mismaLista = (a: ClienteDeRutaSemanal[], b: ClienteDeRutaSemanal[]) =>
  a.length === b.length && a.every((c, i) => c.clienteId === b[i].clienteId);

/**
 * Editar una Ruta Semanal (spec §4): cartera a la izquierda, clientes de la ruta a la
 * derecha, en el orden en que se agregan. Nada se guarda al mover; "Guardar" manda la
 * lista completa y el servidor la propaga a las rutas del día de hoy en adelante.
 */
export function EditarRutaSemanal({
  id,
  sucursal,
  onVolver,
}: {
  id: string;
  sucursal: string;
  onVolver: () => void;
}) {
  const [ruta, setRuta] = useState<RutaSemanalDetalle | null>(null);
  const [cartera, setCartera] = useState<ClienteResumen[]>([]);
  const [original, setOriginal] = useState<ClienteDeRutaSemanal[]>([]);
  const [lista, setLista] = useState<ClienteDeRutaSemanal[]>([]);
  const [nombre, setNombre] = useState("");
  const [cargando, setCargando] = useState(true);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const { confirmar, ventana } = useConfirmar();

  const sucio = !mismaLista(original, lista);
  const enRuta = useMemo(() => new Set(lista.map((c) => c.clienteId)), [lista]);

  useEffect(() => {
    let vigente = true;
    Promise.all([listarClientes(sucursal, "cliente"), obtenerRutaSemanal(id)])
      .then(([clientes, detalle]) => {
        if (!vigente) return;
        setCartera(clientes);
        setRuta(detalle);
        setOriginal(detalle.lista);
        setLista(detalle.lista);
        setNombre(detalle.nombre);
      })
      .catch((err: unknown) => {
        if (vigente) setError(mensajeDe(err, "No se pudo cargar la ruta."));
      })
      .finally(() => {
        if (vigente) setCargando(false);
      });
    return () => {
      vigente = false;
    };
  }, [id, sucursal]);

  // Cerrar la pestaña o recargar con cambios sin guardar: el navegador pregunta.
  useEffect(() => {
    if (!sucio) return;
    const avisar = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", avisar);
    return () => window.removeEventListener("beforeunload", avisar);
  }, [sucio]);

  async function volver() {
    if (
      !sucio ||
      (await confirmar({
        titulo: "¿Descartar los cambios de la ruta?",
        descripcion: "Hay cambios sin guardar en la ruta.",
        confirmar: "Descartar cambios",
      }))
    ) {
      onVolver();
    }
  }

  async function guardar() {
    setOcupado(true);
    setError(null);
    setAviso(null);
    try {
      const detalle = await guardarClientesRutaSemanal(
        id,
        lista.map((c) => c.clienteId),
      );
      setRuta(detalle);
      setOriginal(detalle.lista);
      setLista(detalle.lista);
      setAviso("Ruta guardada.");
    } catch (err) {
      // Es una transacción: si falló, la ruta del servidor no cambió y las ediciones se quedan.
      setError(mensajeDe(err, "No se pudo guardar la ruta. No se cambió nada; vuelve a intentar."));
    } finally {
      setOcupado(false);
    }
  }

  async function guardarNombre() {
    setOcupado(true);
    setError(null);
    setAviso(null);
    try {
      const detalle = await renombrarRutaSemanal(id, nombre.trim());
      setRuta((actual) => (actual ? { ...actual, nombre: detalle.nombre } : detalle));
      setNombre(detalle.nombre);
      setAviso("Nombre guardado.");
    } catch (err) {
      setError(mensajeDe(err, "No se pudo cambiar el nombre."));
    } finally {
      setOcupado(false);
    }
  }

  async function eliminar() {
    if (!ruta) return;
    setOcupado(true);
    setError(null);
    setAviso(null);
    const resultado = await confirmarYEliminarRuta(confirmar, { id, nombre: ruta.nombre });
    if (resultado.estado === "cancelada") {
      setOcupado(false);
      return;
    }
    if (resultado.estado === "eliminada") {
      onVolver();
    } else {
      setError(resultado.mensaje);
      setOcupado(false);
    }
  }

  if (cargando) return <EstadoPantalla tipo="cargando" titulo="Ruta Semanal" />;

  return (
    <Pantalla>
      <div>
        <Button type="button" variant="ghost" size="sm" disabled={ocupado} onClick={() => void volver()}>
          ← Volver a Ruta Semanal
        </Button>
      </div>
      <EncabezadoPantalla
        titulo={ruta?.nombre ?? "Ruta Semanal"}
        descripcion={ruta ? `Los clientes que se visitan cada ${DIAS[ruta.diaSemana]}, en el orden en que se agregan.` : undefined}
        acciones={
          ruta ? (
            <>
              <Button type="button" variant="outline" disabled={ocupado} onClick={() => void eliminar()}>
                Eliminar ruta
              </Button>
              <Button type="button" disabled={!sucio || ocupado} onClick={() => void guardar()}>
                Guardar
              </Button>
            </>
          ) : undefined
        }
      />

      {sucio ? <Aviso tono="advertencia">Cambios sin guardar</Aviso> : null}
      {aviso ? <Aviso tono="exito">{aviso}</Aviso> : null}
      {error ? <Aviso tono="error">{error}</Aviso> : null}

      {ruta ? (
        <>
          <div className="flex flex-wrap items-end gap-2">
            <Campo id="ruta-semanal-nombre" etiqueta="Nombre de la ruta">
              <Entrada
                autoComplete="off"
                maxLength={80}
                value={nombre}
                disabled={ocupado}
                onChange={(e) => setNombre(e.target.value)}
              />
            </Campo>
            <Button
              type="button"
              variant="outline"
              disabled={ocupado || nombre.trim() === "" || nombre.trim() === ruta.nombre}
              onClick={() => void guardarNombre()}
            >
              Guardar nombre
            </Button>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            <CarteraRuta
              cartera={cartera}
              enRuta={enRuta}
              onAgregar={(c) =>
                setLista((actual) => [...actual, { clienteId: c.id, nombre: c.nombre, valido: true }])
              }
            />
            <section aria-label="Clientes de la ruta" className="flex flex-col gap-2">
              <h2 className="text-base font-semibold">Clientes de la ruta: {lista.length}</h2>
              {lista.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sin clientes en la ruta. Agrégalos desde la cartera.</p>
              ) : (
                <ol className="max-h-[28rem] divide-y overflow-y-auto rounded-[10px] border">
                  {lista.map((c, i) => (
                    <li key={c.clienteId} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                      <span className="w-6 text-right text-muted-foreground tabular-nums">{i + 1}</span>
                      <span className="flex-1">{c.nombre}</span>
                      {c.valido ? null : <Etiqueta tono="advertencia">dado de baja</Etiqueta>}
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        aria-label={`Quitar ${c.nombre}`}
                        disabled={ocupado}
                        onClick={() => setLista((actual) => actual.filter((x) => x.clienteId !== c.clienteId))}
                      >
                        Quitar
                      </Button>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </div>
        </>
      ) : null}
      {ventana}
    </Pantalla>
  );
}
