"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { Aviso } from "@/components/ui/aviso";
import { Button } from "@/components/ui/button";
import { Campo, Entrada } from "@/components/ui/campo";
import { useConfirmar } from "@/components/ui/confirmar";
import { EncabezadoPantalla, Pantalla } from "@/components/ui/encabezado-pantalla";
import { EstadoPantalla } from "@/components/ui/estado-pantalla";
import { CajaTabla, Fila, FilaTotal, Tabla, Td, Th } from "@/components/ui/tabla";
import { mensajeDe } from "@/lib/api";
import { formatearFechaHora } from "@/lib/formato";
import { guardarProduccion, leerPiezas, obtenerProduccion, type DiaProduccion } from "@/lib/produccion";
import { hoyEnTijuana } from "@/lib/ventas";

const TITULO = "Producción del día";
const DESCRIPCION = "Las piezas que se hicieron cada día, por sabor y tamaño.";

const textoDe = (piezas: number) => (piezas > 0 ? String(piezas) : "");

/**
 * Producción › Producción del día (T-25): el almacenista anota cuántas piezas se
 * hicieron de cada presentación. Hoy por omisión, días anteriores se corrigen, el
 * futuro no. Vacío o 0 = sin registro; Guardar reemplaza el día completo.
 */
export function PantallaProduccionDia({ sucursal }: { sucursal: string | null }) {
  const { usuario, puede, cargando } = useAuth();

  if (cargando) return <EstadoPantalla titulo={TITULO} tipo="cargando" />;
  if (!puede("almacen_general.gestionar")) return <EstadoPantalla titulo={TITULO} tipo="sin-permiso" />;

  // Atado: siempre la suya. General: la del selector; sin ella ("todas") no hay día que pintar.
  const codigo = usuario?.sucursal?.codigo ?? (sucursal && sucursal.toLowerCase() !== "todas" ? sucursal.toUpperCase() : null);
  if (!codigo) return <EstadoPantalla titulo={TITULO} tipo="elige-sucursal" />;

  return <DiaDeProduccion key={codigo} sucursal={codigo} />;
}

function DiaDeProduccion({ sucursal }: { sucursal: string }) {
  const hoy = hoyEnTijuana();
  const [fecha, setFecha] = useState(hoy);
  const [dia, setDia] = useState<DiaProduccion | null>(null);
  const [borrador, setBorrador] = useState<Record<string, string>>({});
  const [cargandoDia, setCargandoDia] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const ultima = useRef(0);
  const { confirmar, ventana } = useConfirmar();

  useEffect(() => {
    const esta = ++ultima.current;
    setCargandoDia(true);
    obtenerProduccion(fecha, sucursal)
      .then((r) => {
        if (esta !== ultima.current) return;
        setDia(r);
        setBorrador(Object.fromEntries(r.lineas.map((l) => [l.presentacionId, textoDe(l.piezas)])));
      })
      .catch((err: unknown) => {
        if (esta !== ultima.current) return;
        setDia(null);
        setError(mensajeDe(err, "No se pudo cargar la producción."));
      })
      .finally(() => {
        if (esta === ultima.current) setCargandoDia(false);
      });
  }, [fecha, sucursal]);

  const lineas = dia?.lineas ?? [];
  const lectura = (id: string) => leerPiezas(borrador[id] ?? "");
  const hayInvalidas = lineas.some((l) => lectura(l.presentacionId) === null);
  const cambios = lineas.some((l) => lectura(l.presentacionId) !== l.piezas);
  const total = lineas.reduce((suma, l) => suma + (lectura(l.presentacionId) ?? 0), 0);

  function editar(id: string, valor: string) {
    setAviso(null);
    setBorrador((prev) => ({ ...prev, [id]: valor }));
  }

  async function cambiarFecha(nueva: string) {
    if (nueva === "" || nueva === fecha) return;
    if (cambios) {
      const si = await confirmar({
        titulo: "¿Descartar los cambios?",
        descripcion: "Lo que escribiste en este día no se ha guardado.",
        confirmar: "Descartar",
      });
      if (!si) return;
    }
    setError(null);
    setAviso(null);
    setFecha(nueva);
  }

  async function guardar() {
    setGuardando(true);
    setError(null);
    setAviso(null);
    try {
      const r = await guardarProduccion({
        fecha,
        sucursal,
        lineas: lineas.map((l) => ({ presentacionId: l.presentacionId, piezas: lectura(l.presentacionId) ?? 0 })),
      });
      setDia(r);
      setBorrador(Object.fromEntries(r.lineas.map((l) => [l.presentacionId, textoDe(l.piezas)])));
      setAviso("Producción guardada.");
    } catch (err) {
      setError(mensajeDe(err, "No se pudo guardar la producción. Vuelve a intentar."));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Pantalla>
      <EncabezadoPantalla titulo={TITULO} descripcion={DESCRIPCION} />

      <Campo id="produccion-fecha" etiqueta="Fecha" className="w-48">
        <Entrada
          type="date"
          required
          max={hoy}
          value={fecha}
          disabled={guardando}
          onChange={(e) => void cambiarFecha(e.target.value)}
        />
      </Campo>

      {error && <Aviso tono="error">{error}</Aviso>}
      {cargandoDia && <EstadoPantalla tipo="cargando" />}

      {!cargandoDia && dia && lineas.length === 0 && (
        <p className="text-sm text-muted-foreground">No hay presentaciones activas. Da de alta una en el catálogo de productos.</p>
      )}

      {!cargandoDia && dia && lineas.length > 0 && (
        <>
          <CajaTabla>
            <Tabla aria-label="Producción del día">
              <thead>
                <tr>
                  <Th>Producto</Th>
                  <Th>Presentación</Th>
                  <Th alinear="derecha">Piezas</Th>
                </tr>
              </thead>
              <tbody>
                {lineas.map((l) => {
                  const nombre = `${l.producto} ${l.presentacion}`;
                  const mala = lectura(l.presentacionId) === null;
                  return (
                    <Fila key={l.presentacionId} className="align-top">
                      <Td>
                        {l.producto}
                        {!l.activa && <span className="text-muted-foreground"> (dada de baja)</span>}
                      </Td>
                      <Td>{l.presentacion}</Td>
                      <Td alinear="derecha">
                        <Entrada
                          aria-label={`Piezas de ${nombre}`}
                          inputMode="numeric"
                          aria-invalid={mala || undefined}
                          value={borrador[l.presentacionId] ?? ""}
                          disabled={guardando}
                          onChange={(e) => editar(l.presentacionId, e.target.value)}
                          className="w-32 text-right tabular-nums"
                        />
                        {mala && <p className="mt-1 text-xs text-destructive">Solo piezas enteras</p>}
                      </Td>
                    </Fila>
                  );
                })}
              </tbody>
              <tfoot>
                <FilaTotal>
                  <Td colSpan={2}>Total</Td>
                  <Td alinear="derecha" className="tabular-nums">
                    {total}
                  </Td>
                </FilaTotal>
              </tfoot>
            </Tabla>
          </CajaTabla>

          <div className="flex flex-wrap items-center gap-3">
            <Button disabled={guardando || hayInvalidas} onClick={() => void guardar()}>
              {guardando ? "Guardando…" : "Guardar producción"}
            </Button>
            {aviso && <Aviso tono="exito">{aviso}</Aviso>}
            {dia.actualizadoEn && !aviso && (
              <span className="text-xs text-muted-foreground">Última captura: {formatearFechaHora(dia.actualizadoEn)}.</span>
            )}
          </div>
        </>
      )}
      {ventana}
    </Pantalla>
  );
}
