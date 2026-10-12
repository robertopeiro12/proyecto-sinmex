"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { mensajeDe } from "@/lib/api";
import { listarClientes, type ClienteResumen } from "@/lib/clientes";
import {
  aEditables,
  agregarFila,
  cargarAnterior,
  guardarRutaDiaria,
  hayCambios,
  moverFila,
  obtenerRutaAnterior,
  obtenerRutaDiaria,
  quitarFila,
  type FilaEditable,
} from "@/lib/rutas";
import { listarVendedores, type Vendedor } from "@/lib/vendedores";
import { hoyEnTijuana } from "@/lib/ventas";
import { CarteraRuta } from "./cartera-ruta";
import { ListaRutaDiaria } from "./lista-ruta-diaria";

export const AVISO_CAMBIOS = "Hay cambios sin guardar en la ruta. ¿Descartarlos?";

/**
 * Operación → Ruta Diaria (T-37, D17). La oficina arma la ruta de un vendedor
 * para un día: cartera a la izquierda, ruta a la derecha. Nada se guarda al
 * mover; "Guardar ruta" manda la lista completa (reemplazo, D14).
 *
 * Sin mapa, sin seguimiento de visitas, sin efectividad (T-41, pieza 3, T-46) y
 * sin ruta semanal (T-36).
 */
export function PantallaRutaDiaria({ sucursal }: { sucursal: string | null }) {
  const { puede } = useAuth();
  const permitido = puede("ruta_diaria.gestionar");

  const [vendedores, setVendedores] = useState<Vendedor[]>([]);
  const [vendedorId, setVendedorId] = useState("");
  const [fecha, setFecha] = useState(hoyEnTijuana);
  const [cartera, setCartera] = useState<ClienteResumen[]>([]);
  const [original, setOriginal] = useState<FilaEditable[]>([]);
  const [filas, setFilas] = useState<FilaEditable[]>([]);
  const [cargando, setCargando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiando, setCopiando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  const vendedor = vendedores.find((v) => v.id === vendedorId) ?? null;
  // La cartera es la de la sucursal DEL VENDEDOR: el PUT rechaza clientes de otra.
  const sucursalVendedor = vendedor?.sucursalCodigo ?? null;
  const sucio = hayCambios(original, filas);
  const enRuta = useMemo(() => new Set(filas.map((f) => f.clienteId)), [filas]);
  const ocupado = guardando || copiando;

  // Lo vigente al momento de resolver una promesa: una respuesta de otro vendedor o de otra
  // fecha no debe pisar la pantalla actual (y menos acabar guardándose con el vendedor equivocado).
  const vendedoresRef = useRef(vendedores);
  useEffect(() => {
    vendedoresRef.current = vendedores;
  });
  const vigenteRef = useRef({ vendedorId, fecha, sucio });
  useEffect(() => {
    vigenteRef.current = { vendedorId, fecha, sucio };
  });

  useEffect(() => {
    if (!permitido) return;
    let vigente = true;
    listarVendedores(sucursal)
      .then((lista) => {
        if (!vigente) return;
        // Un vendedor desactivado no sale a repartir: no se le arma ruta.
        const activos = lista.filter((v) => v.activo);
        const { vendedorId: elegido, sucio: conCambios } = vigenteRef.current;
        const desaparece = elegido !== "" && !activos.some((v) => v.id === elegido);
        if (desaparece && conCambios && !window.confirm(AVISO_CAMBIOS)) {
          // Cambió la sucursal del selector global pero el usuario no quiere perder la ruta:
          // el vendedor se queda en la lista (aunque sea de otra sucursal) hasta guardar o descartar.
          const elQueSeQueda = vendedoresRef.current.find((v) => v.id === elegido);
          setVendedores(elQueSeQueda ? [...activos, elQueSeQueda] : activos);
          return;
        }
        setVendedores(activos);
        // Si el elegido ya no está, se suelta.
        setVendedorId((actual) => (activos.some((v) => v.id === actual) ? actual : ""));
      })
      .catch(() => {
        if (vigente) setError("No se pudieron cargar los vendedores.");
      });
    return () => {
      vigente = false;
    };
  }, [permitido, sucursal]);

  useEffect(() => {
    if (!vendedorId || !sucursalVendedor) {
      // Sin vendedor no queda ruta a medio editar (ni aviso de cambios fantasma).
      setOriginal([]);
      setFilas([]);
      return;
    }
    let vigente = true;
    setCargando(true);
    setError(null);
    setAviso(null);
    setOriginal([]);
    setFilas([]);
    Promise.all([listarClientes(sucursalVendedor, "cliente"), obtenerRutaDiaria(vendedorId, fecha)])
      .then(([clientes, ruta]) => {
        if (!vigente) return;
        const editables = aEditables(ruta);
        setCartera(clientes);
        setOriginal(editables);
        setFilas(editables);
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
  }, [vendedorId, sucursalVendedor, fecha]);

  // Cerrar la pestaña o recargar con cambios sin guardar: el navegador pregunta.
  useEffect(() => {
    if (!sucio) return;
    const avisar = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = ""; // algunos navegadores solo preguntan con esto
    };
    window.addEventListener("beforeunload", avisar);
    return () => window.removeEventListener("beforeunload", avisar);
  }, [sucio]);

  function puedeDescartar(): boolean {
    return !sucio || window.confirm(AVISO_CAMBIOS);
  }

  function cambiarVendedor(id: string) {
    if (ocupado || id === vendedorId || !puedeDescartar()) return;
    setVendedorId(id);
  }

  function cambiarFecha(valor: string) {
    if (ocupado || valor === "" || valor === fecha || !puedeDescartar()) return;
    setFecha(valor);
  }

  async function guardar() {
    if (!vendedor) return;
    const { id: paraVendedor } = vendedor;
    const paraFecha = fecha;
    const sigueVigente = () =>
      vigenteRef.current.vendedorId === paraVendedor && vigenteRef.current.fecha === paraFecha;
    setGuardando(true);
    setError(null);
    setAviso(null);
    try {
      const ruta = await guardarRutaDiaria({
        vendedorId: paraVendedor,
        fecha: paraFecha,
        clientes: filas.map((f) => f.clienteId),
      });
      if (!sigueVigente()) return;
      const editables = aEditables(ruta);
      setOriginal(editables);
      setFilas(editables);
      setAviso("Ruta guardada.");
    } catch (err) {
      // El PUT es una transacción: si falló, la ruta del servidor no cambió. Las
      // ediciones locales se quedan para quitar la fila problemática y reintentar.
      if (sigueVigente()) {
        setError(mensajeDe(err, "No se pudo guardar la ruta. No se cambió nada; vuelve a intentar."));
      }
    } finally {
      setGuardando(false);
    }
  }

  async function copiarDeAyer() {
    if (!vendedor) return;
    const { id: paraVendedor } = vendedor;
    const paraFecha = fecha;
    setCopiando(true);
    setError(null);
    setAviso(null);
    try {
      const anterior = await obtenerRutaAnterior(paraVendedor, paraFecha);
      if (vigenteRef.current.vendedorId !== paraVendedor || vigenteRef.current.fecha !== paraFecha) return;
      if (anterior.fecha === null) {
        setAviso("Este vendedor no tiene una ruta anterior.");
        return;
      }
      setFilas((actuales) => cargarAnterior(actuales, anterior.clientes, cartera));
      setAviso(`Se cargó la ruta del ${anterior.fecha}. Revísala y guarda.`);
    } catch (err) {
      if (vigenteRef.current.vendedorId === paraVendedor && vigenteRef.current.fecha === paraFecha) {
        setError(mensajeDe(err, "No se pudo leer la ruta anterior."));
      }
    } finally {
      setCopiando(false);
    }
  }

  if (!permitido) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Ruta Diaria</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No tienes permiso para gestionar la ruta diaria</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Ruta Diaria</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="ruta-vendedor" className="text-sm font-medium">
              Vendedor
            </label>
            <select
              id="ruta-vendedor"
              value={vendedorId}
              disabled={ocupado}
              onChange={(e) => cambiarVendedor(e.target.value)}
              className="rounded-md border px-3 py-2 text-sm"
            >
              <option value="">Elige un vendedor</option>
              {vendedores.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.nombre} · {v.sucursalCodigo}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="ruta-fecha" className="text-sm font-medium">
              Fecha
            </label>
            <input
              id="ruta-fecha"
              type="date"
              value={fecha}
              disabled={ocupado}
              onChange={(e) => cambiarFecha(e.target.value)}
              className="rounded-md border px-3 py-2 text-sm"
            />
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={!vendedor || cargando || ocupado}
              onClick={() => void copiarDeAyer()}
            >
              Copiar de ayer
            </Button>
            <Button type="button" disabled={!vendedor || !sucio || ocupado} onClick={() => void guardar()}>
              {guardando ? "Guardando…" : "Guardar ruta"}
            </Button>
          </div>
        </div>

        {sucio ? <p className="text-sm font-medium text-amber-700">Cambios sin guardar</p> : null}
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

        {!vendedor ? (
          <p className="text-sm text-muted-foreground">Elige un vendedor para ver su ruta.</p>
        ) : cargando ? (
          <p className="text-sm text-muted-foreground">Cargando…</p>
        ) : (
          <div className="grid gap-6 md:grid-cols-2">
            <CarteraRuta
              cartera={cartera}
              enRuta={enRuta}
              onAgregar={(c) => setFilas((actuales) => agregarFila(actuales, { id: c.id, nombre: c.nombre }))}
            />
            <ListaRutaDiaria
              filas={filas}
              onMover={(desde, hasta) => setFilas((actuales) => moverFila(actuales, desde, hasta))}
              onQuitar={(indice) => setFilas((actuales) => quitarFila(actuales, indice))}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
