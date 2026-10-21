"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Aviso } from "@/components/ui/aviso";
import { Button } from "@/components/ui/button";
import { Campo, Entrada } from "@/components/ui/campo";
import { useConfirmar } from "@/components/ui/confirmar";
import { EstadoPantalla } from "@/components/ui/estado-pantalla";
import { CajaTabla, Tabla, Td, TdMonto, Th } from "@/components/ui/tabla";
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
import { hoyEnTijuana } from "@/lib/ventas";

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
  const { confirmar, ventana } = useConfirmar();

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
    const si = await confirmar({
      titulo: `¿Eliminar el saldo de "${cuenta}" del ${formatearFecha(f)}?`,
      descripcion: "La Tesorería volverá a usar el anterior.",
      confirmar: "Eliminar saldo",
    });
    if (!si) return;
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
        <Campo id="saldo-fecha" etiqueta="Fecha del saldo">
          <Entrada
            type="date"
            required
            max={hoy}
            value={fecha}
            onChange={(e) => e.target.value && setFecha(e.target.value)}
          />
        </Campo>
        <p className="max-w-xl text-xs text-muted-foreground">
          El saldo vale al <strong>inicio</strong> de ese día: lo que entre o salga ese mismo día se suma encima. El
          primero de cada cuenta es su saldo inicial; uno nuevo en otra fecha es el nuevo punto de partida.
        </p>
      </div>

      {error && <Aviso tono="error">{error}</Aviso>}
      {cargando && <EstadoPantalla tipo="cargando" />}

      {!cargando && dia && cuentas.length === 0 && (
        <p className="text-sm text-muted-foreground">No hay cuentas que puedas modificar. Da de alta una en Cuentas.</p>
      )}

      {!cargando && dia && cuentas.length > 0 && (
        <>
          <CajaTabla>
            <Tabla aria-label="Saldos del día">
              <thead>
                <tr>
                  <Th>Cuenta</Th>
                  <Th>Sucursal</Th>
                  <Th>Monto</Th>
                  <Th>Comentario</Th>
                </tr>
              </thead>
              <tbody>
                {cuentas.map((c) => {
                  const k = captura[c.cuentaId] ?? { monto: "", comentario: "", tocada: false };
                  const mala = invalida(c.cuentaId);
                  return (
                    <tr key={c.cuentaId} className="align-top">
                      <Td>{c.nombre}</Td>
                      <Td className="whitespace-nowrap">{etiquetaSucursalCuenta(c.sucursalCodigo)}</Td>
                      <Td>
                        <Entrada
                          aria-label={`Monto de ${c.nombre}`}
                          inputMode="decimal"
                          placeholder="Sin cambio"
                          value={k.monto}
                          disabled={guardando}
                          onChange={(e) => editar(c.cuentaId, "monto", e.target.value)}
                          className="w-40 text-right tabular-nums"
                        />
                        {mala && k.tocada && <p className="mt-1 text-xs text-destructive">Monto no válido</p>}
                      </Td>
                      <Td>
                        <Entrada
                          aria-label={`Comentario de ${c.nombre}`}
                          maxLength={200}
                          value={k.comentario}
                          disabled={guardando}
                          onChange={(e) => editar(c.cuentaId, "comentario", e.target.value)}
                          className="w-full min-w-48"
                        />
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Tabla>
          </CajaTabla>

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
          <CajaTabla>
            <Tabla aria-label="Saldos fijados">
              <thead>
                <tr>
                  <Th>Fecha</Th>
                  <Th>Cuenta</Th>
                  <Th alinear="derecha">Monto</Th>
                  <Th>Comentario</Th>
                  <Th>Capturó</Th>
                  <Th>
                    <span className="sr-only">Acciones</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {dia.saldos.map((s) => (
                  <tr key={s.id}>
                    <Td className="whitespace-nowrap">{formatearFecha(s.fecha)}</Td>
                    <Td>{s.cuentaNombre}</Td>
                    <TdMonto centavos={s.montoCentavos} />
                    <Td>{s.comentario ?? "—"}</Td>
                    <Td>{s.capturo}</Td>
                    <Td alinear="derecha">
                      <Button variant="outline" size="sm" onClick={() => void alEliminar(s.id, s.cuentaNombre, s.fecha)}>
                        Eliminar
                      </Button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Tabla>
          </CajaTabla>
        </div>
      )}
      {ventana}
    </div>
  );
}
