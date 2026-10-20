"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorApi, mensajeDe } from "@/lib/api";
import {
  borradorDe,
  crearCarga,
  editarCarga,
  eliminarCarga,
  leerBorrador,
  obtenerRejilla,
  type CargaRejilla,
  type Rejilla,
} from "@/lib/cargas";
import { listarSucursales, type Sucursal } from "@/lib/sucursales";
import { hoyEnTijuana } from "@/lib/ventas";
import { RejillaCargas, type Edicion } from "./rejilla-cargas";

/**
 * Producción › Recarga (T-27 pieza 1, D1): el almacenista registra la carga de la
 * mañana y cada recarga de cada vendedor; la carga baja a la tablet y el vendedor
 * la acepta o la rechaza (D2). Una rechazada se corrige con "Editar" y vuelve a
 * llegarle. Días anteriores, solo lectura (D8).
 */
function esConflicto(err: unknown): boolean {
  return err instanceof ErrorApi && err.status === 409;
}

export function PantallaRecarga({ sucursal }: { sucursal: string | null }) {
  const { puede, cargando: cargandoSesion, usuario } = useAuth();
  const permitido = puede("carga.gestionar");
  const propia = usuario?.sucursal?.id ?? null;

  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  const [sucursalId, setSucursalId] = useState("");
  const [fecha, setFecha] = useState(hoyEnTijuana);
  const [rejilla, setRejilla] = useState<Rejilla | null>(null);
  const [vuelta, setVuelta] = useState(0);
  const [edicion, setEdicion] = useState<Edicion | null>(null);
  const [cargando, setCargando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const hoy = hoyEnTijuana();
  const esHoy = fecha === hoy;

  useEffect(() => {
    if (!permitido) return;
    let vigente = true;
    listarSucursales(null)
      .then((lista) => {
        if (!vigente) return;
        // Un usuario atado recibe solo la suya; un General elige (el selector
        // global de la barra, si viene, manda al abrir).
        const activas = lista.filter((s) => s.activa);
        setSucursales(activas);
        setSucursalId((actual) => {
          if (actual !== "" && activas.some((s) => s.id === actual)) return actual;
          const delSelector = activas.find((s) => s.codigo === sucursal?.toUpperCase());
          const deUsuario = activas.find((s) => s.id === propia);
          return (delSelector ?? deUsuario ?? activas[0])?.id ?? "";
        });
      })
      .catch(() => {
        if (vigente) setError("No se pudieron cargar las sucursales.");
      });
    return () => {
      vigente = false;
    };
  }, [permitido, sucursal, propia]);

  useEffect(() => {
    if (sucursalId === "") return;
    let vigente = true;
    // El error NO se limpia aqui: un 409 pide esta misma recarga y su mensaje
    // tiene que seguir a la vista. Lo limpian el cambio de filtro y cada accion.
    setCargando(true);
    obtenerRejilla(fecha, sucursalId)
      .then((r) => {
        if (vigente) setRejilla(r);
      })
      .catch((err: unknown) => {
        if (vigente) {
          setRejilla(null);
          setError(mensajeDe(err, "No se pudo cargar la recarga."));
        }
      })
      .finally(() => {
        if (vigente) setCargando(false);
      });
    return () => {
      vigente = false;
    };
  }, [sucursalId, fecha, vuelta]);

  async function guardar() {
    if (!edicion) return;
    const { lineas, error: errorBorrador } = leerBorrador(edicion.borrador);
    if (errorBorrador !== null) {
      setError(errorBorrador);
      return;
    }
    setGuardando(true);
    setError(null);
    setAviso(null);
    try {
      if (edicion.carga) {
        await editarCarga(edicion.carga.id, { version: edicion.carga.version, lineas });
      } else {
        await crearCarga({ vendedorId: edicion.vendedorId, lineas });
      }
      setEdicion(null);
      setAviso("Carga guardada. Le llega al vendedor cuando sincronice.");
      setVuelta((n) => n + 1);
    } catch (err) {
      // Un 409 trae el motivo del servidor (aceptada, de otro dia, editada por otro).
      setError(mensajeDe(err, "No se pudo guardar la carga. Vuelve a intentar."));
      if (esConflicto(err)) {
        // Lo capturado ya no aplica a la carga actual: se cierra la captura y se
        // pinta lo que hay en el servidor (reintentar daria el mismo 409).
        setEdicion(null);
        setVuelta((n) => n + 1);
      }
    } finally {
      setGuardando(false);
    }
  }

  async function eliminar(vendedorNombre: string, carga: CargaRejilla) {
    if (!window.confirm(`¿Eliminar la carga n.º ${carga.numero} de ${vendedorNombre}?`)) return;
    setGuardando(true);
    setError(null);
    setAviso(null);
    try {
      await eliminarCarga(carga.id, carga.version);
      setAviso("Carga eliminada.");
      setVuelta((n) => n + 1);
    } catch (err) {
      setError(mensajeDe(err, "No se pudo eliminar la carga."));
      if (esConflicto(err)) setVuelta((n) => n + 1);
    } finally {
      setGuardando(false);
    }
  }

  if (cargandoSesion || !permitido) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Recarga</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {cargandoSesion ? "Cargando…" : "No tienes permiso para registrar cargas."}
          </p>
        </CardContent>
      </Card>
    );
  }

  const bloqueado = edicion !== null || guardando;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recarga</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="recarga-sucursal" className="text-sm font-medium">
              Sucursal
            </label>
            <select
              id="recarga-sucursal"
              value={sucursalId}
              disabled={bloqueado || sucursales.length <= 1}
              onChange={(e) => {
                setError(null);
                setAviso(null);
                setSucursalId(e.target.value);
              }}
              className="rounded-md border px-3 py-2 text-sm"
            >
              {sucursales.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.codigo} · {s.nombre}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="recarga-fecha" className="text-sm font-medium">
              Fecha
            </label>
            <input
              id="recarga-fecha"
              type="date"
              value={fecha}
              max={hoy}
              disabled={bloqueado}
              onChange={(e) => {
                if (e.target.value === "") return;
                setError(null);
                setAviso(null);
                setFecha(e.target.value);
              }}
              className="rounded-md border px-3 py-2 text-sm"
            />
          </div>
        </div>

        {!esHoy ? (
          <p className="text-sm text-muted-foreground">
            Día anterior: solo lectura. Las cargas se capturan el día en que sale el producto.
          </p>
        ) : null}
        {aviso ? (
          <p role="status" className="text-sm text-muted-foreground">
            {aviso}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}

        {cargando && rejilla === null ? (
          <p className="text-sm text-muted-foreground">Cargando…</p>
        ) : rejilla ? (
          <RejillaCargas
            rejilla={rejilla}
            esHoy={esHoy}
            edicion={edicion}
            ocupado={guardando}
            onNueva={(vendedorId) => {
              setAviso(null);
              setError(null);
              setEdicion({ vendedorId, carga: null, borrador: borradorDe(null) });
            }}
            onEditar={(vendedorId, carga) => {
              setAviso(null);
              setError(null);
              // Solo las presentaciones activas: una dada de baja no tiene campo y
              // el servidor la rechazaria (ver borradorDe).
              setEdicion({ vendedorId, carga, borrador: borradorDe(carga, rejilla.presentaciones) });
            }}
            onEliminar={(vendedorNombre, carga) => void eliminar(vendedorNombre, carga)}
            onPiezas={(presentacionId, texto) =>
              setEdicion((actual) =>
                actual ? { ...actual, borrador: { ...actual.borrador, [presentacionId]: texto } } : actual,
              )
            }
            onGuardar={() => void guardar()}
            onCancelar={() => {
              setEdicion(null);
              setError(null);
            }}
          />
        ) : null}
      </CardContent>
    </Card>
  );
}
