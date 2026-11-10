"use client";

import { useEffect, useMemo, useState } from "react";
import { Aviso } from "@/components/ui/aviso";
import { Button } from "@/components/ui/button";
import { Campo, Lista } from "@/components/ui/campo";
import { useConfirmar } from "@/components/ui/confirmar";
import { EncabezadoPantalla, Pantalla } from "@/components/ui/encabezado-pantalla";
import { EstadoPantalla } from "@/components/ui/estado-pantalla";
import { mensajeDe } from "@/lib/api";
import { listarClientes, type ClienteResumen } from "@/lib/clientes";
import { formatearDiaLargo } from "@/lib/formato";
import {
  aEditable,
  agregarFila,
  aplicarRutaSemanal,
  fijarRecado,
  guardarRutaDiaria,
  hayCambios,
  moverFila,
  obtenerOpciones,
  obtenerRutaDiaria,
  quitarFila,
  type OpcionesDia,
  type RutaDiaria,
  type RutaEditable,
} from "@/lib/rutas";
import { CarteraRuta } from "./cartera-ruta";
import { ListaRutaDiaria } from "./lista-ruta-diaria";

const VACIA: RutaEditable = { rutaSemanalId: null, vehiculoId: null, filas: [] };

/**
 * La ruta de un vendedor en un día (spec §5.2), a pantalla completa: la ruta semanal del
 * día (sus clientes se copian al escogerla), el vehículo y los clientes en orden con su
 * recado. Nada se guarda al mover; "Guardar" manda todo junto (reemplazo) y regresa a la
 * lista del día. Un día pasado se ve en solo lectura.
 */
export function RutaDeVendedor({
  vendedorId,
  vendedorNombre,
  fecha,
  sucursal,
  onVolver,
}: {
  vendedorId: string;
  vendedorNombre: string;
  fecha: string;
  sucursal: string;
  /** `guardada`: hubo un guardado y la lista del día debe releerse. */
  onVolver: (guardada: boolean) => void;
}) {
  const [ruta, setRuta] = useState<RutaDiaria | null>(null);
  const [opciones, setOpciones] = useState<OpcionesDia>({ rutas: [], vehiculos: [] });
  const [cartera, setCartera] = useState<ClienteResumen[]>([]);
  const [original, setOriginal] = useState<RutaEditable>(VACIA);
  const [actual, setActual] = useState<RutaEditable>(VACIA);
  const [cargando, setCargando] = useState(true);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { confirmar, ventana } = useConfirmar();

  const editable = ruta?.editable ?? false;
  const sucio = hayCambios(original, actual);
  const enRuta = useMemo(() => new Set(actual.filas.map((f) => f.clienteId)), [actual.filas]);
  const titulo = `Ruta de ${ruta?.vendedor.nombre ?? vendedorNombre} · ${formatearDiaLargo(fecha)}`;

  useEffect(() => {
    let vigente = true;
    Promise.all([obtenerRutaDiaria(vendedorId, fecha), obtenerOpciones(vendedorId, fecha), listarClientes(sucursal, "cliente")])
      .then(([diaria, opcionesDelDia, clientes]) => {
        if (!vigente) return;
        const editableInicial = aEditable(diaria);
        setRuta(diaria);
        setOpciones(opcionesDelDia);
        setCartera(clientes);
        setOriginal(editableInicial);
        setActual(editableInicial);
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
  }, [vendedorId, fecha, sucursal]);

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

  // La ruta guardada pudo salir de las opciones (dada de baja): se sigue ofreciendo para no perderla.
  // Sin clientes (ya no tiene lista que copiar) y marcada `dadaDeBaja`: se puede conservar
  // mientras sea la escogida, pero no volver a escoger.
  const rutas = useMemo(() => {
    const guardada = ruta?.rutaSemanal;
    const lista = opciones.rutas.map((r) => ({ ...r, dadaDeBaja: false }));
    return guardada && !opciones.rutas.some((r) => r.id === guardada.id)
      ? [{ ...guardada, ocupadaPor: null, clientes: [], dadaDeBaja: true }, ...lista]
      : lista;
  }, [ruta, opciones.rutas]);
  const vehiculos = useMemo(() => {
    const guardado = ruta?.vehiculo;
    return guardado && !opciones.vehiculos.some((v) => v.id === guardado.id)
      ? [{ ...guardado, ocupadoPor: null }, ...opciones.vehiculos]
      : opciones.vehiculos;
  }, [ruta, opciones.vehiculos]);

  async function volver() {
    if (
      !sucio ||
      (await confirmar({
        titulo: "¿Descartar los cambios de la ruta?",
        descripcion: "Hay cambios sin guardar en la ruta.",
        confirmar: "Descartar cambios",
      }))
    ) {
      onVolver(false);
    }
  }

  async function cambiarRuta(valor: string) {
    const nueva = valor === "" ? null : valor;
    if (nueva === actual.rutaSemanalId) return;
    const elegida = rutas.find((r) => r.id === nueva);
    if (elegida?.dadaDeBaja) return; // una ruta dada de baja no se vuelve a escoger
    if (
      actual.filas.some((f) => f.origen === "semanal") &&
      !(await confirmar({
        titulo: "¿Reemplazar los clientes de la ruta?",
        descripcion:
          "Salen los clientes que llegaron de la ruta anterior (con sus notas asignadas) y entran los de la nueva. Los que se agregaron a mano se quedan.",
        confirmar: "Reemplazar",
        tono: "normal",
      }))
    ) {
      return;
    }
    setError(null);
    // Los clientes vienen en las opciones del día: `GET /rutas/semanales/:id` exige
    // `ruta_semanal.gestionar`, que quien arma la ruta del día puede no tener.
    const clientes = elegida?.clientes ?? [];
    setActual((a) => ({ ...a, rutaSemanalId: nueva, filas: aplicarRutaSemanal(a.filas, clientes) }));
  }

  async function quitar(indice: number) {
    const fila = actual.filas[indice];
    if (!fila) return;
    const n = fila.notasAsignadas;
    if (
      n > 0 &&
      !(await confirmar({
        titulo: `¿Quitar a ${fila.clienteNombre} de la ruta?`,
        descripcion:
          n === 1
            ? `${fila.clienteNombre} tiene 1 nota asignada; se le quitará.`
            : `${fila.clienteNombre} tiene ${n} notas asignadas; se le quitarán.`,
        confirmar: "Quitar",
      }))
    ) {
      return;
    }
    // Mientras la pregunta estaba abierta la lista pudo moverse: se busca por cliente.
    setActual((a) => ({
      ...a,
      filas: quitarFila(
        a.filas,
        a.filas.findIndex((f) => f.clienteId === fila.clienteId),
      ),
    }));
  }

  async function guardar() {
    setOcupado(true);
    setError(null);
    try {
      await guardarRutaDiaria({
        vendedorId,
        fecha,
        rutaSemanalId: actual.rutaSemanalId,
        vehiculoId: actual.vehiculoId,
        clientes: actual.filas.map((f) => ({ clienteId: f.clienteId, recado: f.recado })),
      });
      onVolver(true);
    } catch (err) {
      // Es una transacción: si falló, la ruta del servidor no cambió y las ediciones se quedan.
      setError(mensajeDe(err, "No se pudo guardar la ruta. No se cambió nada; vuelve a intentar."));
      setOcupado(false);
    }
  }

  if (cargando) return <EstadoPantalla tipo="cargando" titulo={titulo} />;

  return (
    <Pantalla>
      <div>
        <Button type="button" variant="ghost" size="sm" disabled={ocupado} onClick={() => void volver()}>
          ← Volver a Ruta Diaria
        </Button>
      </div>
      <EncabezadoPantalla
        titulo={titulo}
        descripcion="La ruta, el vehículo y los clientes que visita ese día, en orden y con su recado."
        acciones={
          ruta && editable ? (
            <Button type="button" disabled={!sucio || ocupado} onClick={() => void guardar()}>
              {ocupado ? "Guardando…" : "Guardar"}
            </Button>
          ) : undefined
        }
      />

      {ruta && !editable ? <Aviso tono="informacion">Ese día ya pasó; solo se puede consultar.</Aviso> : null}
      {sucio ? <Aviso tono="advertencia">Cambios sin guardar</Aviso> : null}
      {error ? <Aviso tono="error">{error}</Aviso> : null}

      {ruta ? (
        <>
          <div className="flex flex-wrap items-end gap-4">
            <Campo id="ruta-del-dia" etiqueta="Ruta del día" className="w-72">
              <Lista
                value={actual.rutaSemanalId ?? ""}
                disabled={!editable || ocupado}
                onChange={(e) => void cambiarRuta(e.target.value)}
              >
                <option value="">Sin ruta</option>
                {rutas.map((r) => (
                  <option
                    key={r.id}
                    value={r.id}
                    disabled={r.ocupadaPor !== null || (r.dadaDeBaja && r.id !== actual.rutaSemanalId)}
                  >
                    {r.ocupadaPor
                      ? `${r.nombre} (la trae ${r.ocupadaPor})`
                      : r.dadaDeBaja && r.id !== actual.rutaSemanalId
                        ? `${r.nombre} (dada de baja)`
                        : r.nombre}
                  </option>
                ))}
              </Lista>
            </Campo>
            <Campo id="vehiculo-del-dia" etiqueta="Vehículo" className="w-72">
              <Lista
                value={actual.vehiculoId ?? ""}
                disabled={!editable || ocupado}
                onChange={(e) => {
                  const vehiculoId = e.target.value === "" ? null : e.target.value;
                  setActual((a) => ({ ...a, vehiculoId }));
                }}
              >
                <option value="">Sin vehículo</option>
                {vehiculos.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.ocupadoPor ? `${v.nombre} (lo trae ${v.ocupadoPor})` : v.nombre}
                  </option>
                ))}
              </Lista>
            </Campo>
          </div>

          <div className={editable ? "grid gap-6 md:grid-cols-2" : "max-w-2xl"}>
            {editable ? (
              <CarteraRuta
                cartera={cartera}
                enRuta={enRuta}
                onAgregar={(c) => setActual((a) => ({ ...a, filas: agregarFila(a.filas, c) }))}
              />
            ) : null}
            <ListaRutaDiaria
              filas={actual.filas}
              editable={editable}
              onMover={(desde, hasta) => setActual((a) => ({ ...a, filas: moverFila(a.filas, desde, hasta) }))}
              onQuitar={(indice) => void quitar(indice)}
              onRecado={(indice, texto) => setActual((a) => ({ ...a, filas: fijarRecado(a.filas, indice, texto) }))}
            />
          </div>
        </>
      ) : null}
      {ventana}
    </Pantalla>
  );
}
