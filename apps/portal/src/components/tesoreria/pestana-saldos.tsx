"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { mensajeDe } from "@/lib/api";
import { formatearFecha } from "@/lib/reportes";
import {
  eliminarSaldoFijado,
  etiquetaSucursalCuenta,
  guardarSaldos,
  leerMontoConSignoCentavos,
  obtenerSaldosDelDia,
  textoMontoConSigno,
  type SaldosDelDia,
} from "@/lib/tesoreria";
import { formatearPesos, hoyEnTijuana } from "@/lib/ventas";

interface Captura {
  monto: string;
  comentario: string;
  tocada: boolean;
}

/**
 * Fijar el saldo de las cuentas en una fecha (saldo inicial o "modificar saldo",
 * spec §3.3). Una fila por cuenta; solo se mandan las que cambiaron.
 */
export function PestanaSaldos({ sucursal }: { sucursal: string | null }) {
  const hoy = hoyEnTijuana();
  const [fecha, setFecha] = useState(hoy);
  const [dia, setDia] = useState<SaldosDelDia | null>(null);
  const [captura, setCaptura] = useState<Record<string, Captura>>({});
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const ultima = useRef(0);

  const cargar = useCallback(
    async (f: string) => {
      const esta = ++ultima.current;
      setCargando(true);
      setError(null);
      try {
        const r = await obtenerSaldosDelDia({ fecha: f, sucursal });
        if (esta !== ultima.current) return;
        setDia(r);
        setCaptura(
          Object.fromEntries(
            r.cuentas.map((c) => [
              c.cuentaId,
              {
                monto: c.saldo ? textoMontoConSigno(c.saldo.montoCentavos) : "",
                comentario: c.saldo?.comentario ?? "",
                tocada: false,
              },
            ]),
          ),
        );
      } catch (err) {
        if (esta !== ultima.current) return;
        setDia(null);
        setError(mensajeDe(err, "No se pudieron cargar los saldos."));
      } finally {
        if (esta === ultima.current) setCargando(false);
      }
    },
    [sucursal],
  );

  useEffect(() => {
    void cargar(fecha);
  }, [cargar, fecha]);

  function editar(cuentaId: string, campo: "monto" | "comentario", valor: string) {
    setAviso(null);
    setCaptura((prev) => ({ ...prev, [cuentaId]: { ...prev[cuentaId], [campo]: valor, tocada: true } }));
  }

  const cuentas = dia?.cuentas ?? [];
  const cambiadas = cuentas.filter((c) => {
    const k = captura[c.cuentaId];
    if (!k || k.monto.trim() === "") return false;
    const original = c.saldo ? textoMontoConSigno(c.saldo.montoCentavos) : "";
    return k.monto.trim() !== original || k.comentario.trim() !== (c.saldo?.comentario ?? "");
  });
  const invalida = (cuentaId: string) => {
    const k = captura[cuentaId];
    return !!k && k.monto.trim() !== "" && leerMontoConSignoCentavos(k.monto) === null;
  };
  const hayInvalidas = cuentas.some((c) => invalida(c.cuentaId));

  async function alGuardar() {
    setError(null);
    setAviso(null);
    if (cambiadas.length === 0) {
      setAviso("No hay cambios que guardar.");
      return;
    }
    setGuardando(true);
    try {
      const r = await guardarSaldos({
        fecha,
        saldos: cambiadas.map((c) => {
          const k = captura[c.cuentaId];
          const comentario = k.comentario.trim();
          return {
            cuentaId: c.cuentaId,
            montoCentavos: leerMontoConSignoCentavos(k.monto)!,
            ...(comentario ? { comentario } : {}),
          };
        }),
      });
      await cargar(fecha);
      setAviso(
        `Se ${r.guardados === 1 ? "guardó 1 saldo" : `guardaron ${r.guardados} saldos`} del ${formatearFecha(fecha)}.`,
      );
    } catch (err) {
      setError(mensajeDe(err, "No se pudieron guardar los saldos."));
    } finally {
      setGuardando(false);
    }
  }

  async function alEliminar(id: string, cuenta: string, f: string) {
    if (!window.confirm(`¿Eliminar el saldo de "${cuenta}" del ${formatearFecha(f)}? La Tesorería volverá a usar el anterior.`))
      return;
    setError(null);
    try {
      await eliminarSaldoFijado(id);
      await cargar(fecha);
    } catch (err) {
      setError(mensajeDe(err, "No se pudo eliminar el saldo."));
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="saldo-fecha" className="text-sm font-medium">
            Fecha del saldo
          </label>
          <input
            id="saldo-fecha"
            type="date"
            required
            max={hoy}
            value={fecha}
            onChange={(e) => e.target.value && setFecha(e.target.value)}
            className="rounded-md border px-3 py-2 text-sm"
          />
        </div>
        <p className="max-w-xl text-xs text-muted-foreground">
          El saldo vale al <strong>inicio</strong> de ese día: lo que entre o salga ese mismo día se suma encima. El
          primero de cada cuenta es su saldo inicial; uno nuevo en otra fecha es el nuevo punto de partida.
        </p>
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {cargando && <p className="text-sm text-muted-foreground">Cargando…</p>}

      {!cargando && dia && cuentas.length === 0 && (
        <p className="text-sm text-muted-foreground">No hay cuentas que puedas modificar. Da de alta una en Cuentas.</p>
      )}

      {!cargando && dia && cuentas.length > 0 && (
        <>
          <table className="w-full text-sm" aria-label="Saldos del día">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-4 font-medium">Cuenta</th>
                <th className="py-2 pr-4 font-medium">Sucursal</th>
                <th className="py-2 pr-4 font-medium">Monto</th>
                <th className="py-2 font-medium">Comentario</th>
              </tr>
            </thead>
            <tbody>
              {cuentas.map((c) => {
                const k = captura[c.cuentaId] ?? { monto: "", comentario: "", tocada: false };
                const mala = invalida(c.cuentaId);
                return (
                  <tr key={c.cuentaId} className="border-b last:border-0 align-top">
                    <td className="py-2 pr-4">{c.nombre}</td>
                    <td className="whitespace-nowrap py-2 pr-4">{etiquetaSucursalCuenta(c.sucursalCodigo)}</td>
                    <td className="py-2 pr-4">
                      <input
                        aria-label={`Monto de ${c.nombre}`}
                        inputMode="decimal"
                        placeholder="Sin cambio"
                        value={k.monto}
                        disabled={guardando}
                        onChange={(e) => editar(c.cuentaId, "monto", e.target.value)}
                        className="w-40 rounded-md border px-3 py-1.5 text-right text-sm tabular-nums"
                      />
                      {mala && k.tocada && <p className="mt-1 text-xs text-destructive">Monto no válido</p>}
                    </td>
                    <td className="py-2">
                      <input
                        aria-label={`Comentario de ${c.nombre}`}
                        maxLength={200}
                        value={k.comentario}
                        disabled={guardando}
                        onChange={(e) => editar(c.cuentaId, "comentario", e.target.value)}
                        className="w-full min-w-48 rounded-md border px-3 py-1.5 text-sm"
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div className="flex items-center gap-3">
            <Button disabled={guardando || hayInvalidas} onClick={() => void alGuardar()}>
              {guardando ? "Guardando…" : "Guardar saldos"}
            </Button>
            {aviso && <p className="text-sm text-muted-foreground">{aviso}</p>}
          </div>
        </>
      )}

      {dia && dia.saldos.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">Saldos fijados</h3>
          <table className="w-full text-sm" aria-label="Saldos fijados">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-4 font-medium">Fecha</th>
                <th className="py-2 pr-4 font-medium">Cuenta</th>
                <th className="py-2 pr-4 text-right font-medium">Monto</th>
                <th className="py-2 pr-4 font-medium">Comentario</th>
                <th className="py-2 pr-4 font-medium">Capturó</th>
                <th className="py-2">
                  <span className="sr-only">Acciones</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {dia.saldos.map((s) => (
                <tr key={s.id} className="border-b last:border-0">
                  <td className="whitespace-nowrap py-2 pr-4">{formatearFecha(s.fecha)}</td>
                  <td className="py-2 pr-4">{s.cuentaNombre}</td>
                  <td
                    className={`whitespace-nowrap py-2 pr-4 text-right tabular-nums ${s.montoCentavos < 0 ? "text-destructive" : ""}`}
                  >
                    {formatearPesos(s.montoCentavos)}
                  </td>
                  <td className="py-2 pr-4">{s.comentario ?? "—"}</td>
                  <td className="py-2 pr-4">{s.capturo}</td>
                  <td className="py-2 text-right">
                    <Button variant="outline" size="sm" onClick={() => void alEliminar(s.id, s.cuentaNombre, s.fecha)}>
                      Eliminar
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
