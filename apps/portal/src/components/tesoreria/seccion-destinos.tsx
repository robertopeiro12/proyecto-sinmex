"use client";

import { useCallback, useEffect, useState } from "react";
import { Aviso } from "@/components/ui/aviso";
import { Button } from "@/components/ui/button";
import { Entrada, Lista } from "@/components/ui/campo";
import { CajaTabla, Tabla, Td, Th } from "@/components/ui/tabla";
import { mensajeDe } from "@/lib/api";
import { formatearFecha } from "@/lib/reportes";
import {
  ETIQUETA_METODO,
  guardarDestino,
  obtenerDestinos,
  type CuentaTesoreria,
  type DestinosSucursal,
  type MetodoCobranza,
} from "@/lib/tesoreria";
import { hoyEnTijuana } from "@/lib/ventas";

const METODOS: MetodoCobranza[] = ["efectivo", "transferencia", "cheque"];

/**
 * T-29 (spec §3.3): a qué cuenta entra la cobranza de cada sucursal por método.
 * Cambiar es agregar una vigencia "desde": lo anterior no se mueve.
 */
export function SeccionDestinos({ sucursal, cuentas }: { sucursal: string | null; cuentas: CuentaTesoreria[] }) {
  const hoy = hoyEnTijuana();
  const [datos, setDatos] = useState<DestinosSucursal[] | null>(null);
  const [eleccion, setEleccion] = useState<Record<string, string>>({});
  const [desde, setDesde] = useState<Record<string, string>>({});
  const [guardando, setGuardando] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    try {
      const r = await obtenerDestinos(sucursal);
      setDatos(r);
      setEleccion(
        Object.fromEntries(r.flatMap((s) => METODOS.map((m) => [`${s.sucursalId}:${m}`, s.vigentes[m]?.cuentaId ?? ""]))),
      );
    } catch (err) {
      setError(mensajeDe(err, "No se pudo cargar a qué cuenta entra la cobranza."));
    }
  }, [sucursal]);

  // Se recarga también si cambian las cuentas (p. ej. se renombró una en esta misma pestaña).
  const llaveCuentas = cuentas.map((c) => `${c.id}:${c.nombre}`).join("|");
  useEffect(() => {
    void cargar();
  }, [cargar, llaveCuentas]);

  async function guardarFila(s: DestinosSucursal) {
    const cambios = METODOS.filter((m) => {
      const nueva = eleccion[`${s.sucursalId}:${m}`] ?? "";
      return nueva !== "" && nueva !== (s.vigentes[m]?.cuentaId ?? "");
    });
    if (cambios.length === 0) return;
    setGuardando(s.sucursalId);
    setError(null);
    setAviso(null);
    let actual: MetodoCobranza | null = null;
    try {
      for (const m of cambios) {
        actual = m;
        await guardarDestino({
          sucursalId: s.sucursalId,
          metodo: m,
          cuentaId: eleccion[`${s.sucursalId}:${m}`],
          desde: desde[s.sucursalId] ?? hoy,
        });
      }
      // Un "desde" anterior al vigente se guarda, pero no cambia lo que rige hoy: que no parezca que falló.
      const elegida = desde[s.sucursalId] ?? hoy;
      const avisos = cambios.flatMap((m) => {
        const vigente = s.vigentes[m];
        return vigente && elegida < vigente.desde
          ? [`Guardado desde ${formatearFecha(elegida)}; hoy sigue vigente ${vigente.cuentaNombre} desde ${formatearFecha(vigente.desde)}.`]
          : [];
      });
      if (avisos.length > 0) setAviso(avisos.join(" "));
    } catch (err) {
      const que = actual ? `${ETIQUETA_METODO[actual].toLowerCase()} de ${s.sucursalCodigo}` : s.sucursalCodigo;
      setError(`No se pudo guardar ${que}: ${mensajeDe(err, "error desconocido.")}`);
    } finally {
      // Aunque falle uno, lo que ya se guardó en el servidor debe verse.
      await cargar();
      setGuardando(null);
    }
  }

  if (datos === null) return error ? <Aviso tono="error">{error}</Aviso> : null;

  return (
    <section className="flex flex-col gap-3 border-t pt-5">
      <h3 className="text-sm font-semibold">¿A qué cuenta entra la cobranza?</h3>
      <p className="text-xs text-muted-foreground">
        Los cobros del portal y de la tablet, y las ventas de contado, suman solos a esta cuenta según su sucursal y
        cómo se pagaron. Un cambio cuenta desde la fecha que elijas; lo anterior no se mueve.
      </p>
      {error && <Aviso tono="error">{error}</Aviso>}
      {aviso && <Aviso tono="informacion">{aviso}</Aviso>}
      <CajaTabla>
        <Tabla aria-label="Destinos de la cobranza">
          <thead>
            <tr>
              <Th>Sucursal</Th>
              {METODOS.map((m) => (
                <Th key={m}>{ETIQUETA_METODO[m]}</Th>
              ))}
              <Th>Desde</Th>
              <Th><span className="sr-only">Acciones</span></Th>
            </tr>
          </thead>
          <tbody>
            {datos.map((s) => {
              const opciones = cuentas.filter((c) => c.sucursalCodigo === s.sucursalCodigo || c.sucursalId === null);
              return (
                <tr key={s.sucursalId}>
                  <Td className="whitespace-nowrap">{s.sucursalCodigo} · {s.sucursalNombre}</Td>
                  {METODOS.map((m) => (
                    <Td key={m}>
                      <Lista
                        aria-label={`${ETIQUETA_METODO[m]} de ${s.sucursalCodigo}`}
                        className="w-full min-w-40"
                        value={eleccion[`${s.sucursalId}:${m}`] ?? ""}
                        onChange={(e) => setEleccion((p) => ({ ...p, [`${s.sucursalId}:${m}`]: e.target.value }))}
                      >
                        {!s.vigentes[m] && <option value="">Sin cuenta</option>}
                        {s.vigentes[m] && !opciones.some((c) => c.id === s.vigentes[m]!.cuentaId) && (
                          <option value={s.vigentes[m]!.cuentaId}>{s.vigentes[m]!.cuentaNombre}</option>
                        )}
                        {opciones.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.sucursalId === null ? `${c.nombre} · General` : c.nombre}
                          </option>
                        ))}
                      </Lista>
                    </Td>
                  ))}
                  <Td>
                    <Entrada
                      type="date"
                      aria-label={`Desde, ${s.sucursalCodigo}`}
                      max={hoy}
                      value={desde[s.sucursalId] ?? hoy}
                      onChange={(e) => e.target.value && setDesde((p) => ({ ...p, [s.sucursalId]: e.target.value }))}
                    />
                  </Td>
                  <Td alinear="derecha">
                    <Button size="sm" variant="outline" disabled={guardando !== null} onClick={() => void guardarFila(s)}>
                      {guardando === s.sucursalId ? "Guardando…" : "Guardar"}
                    </Button>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Tabla>
      </CajaTabla>
      {datos.some((s) => s.historial.length > 0) && (
        <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
          {datos.flatMap((s) =>
            s.historial.map((d) => (
              <li key={d.id}>
                {d.sucursalCodigo} · {ETIQUETA_METODO[d.metodo]} → {d.cuentaNombre} desde {formatearFecha(d.desde)}
              </li>
            )),
          )}
        </ul>
      )}
    </section>
  );
}
