"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { diaAnterior, rangoMes, rangoSemana, type RangoFechas } from "@/lib/fechas";
import { hoyEnTijuana } from "@/lib/ventas";
import { Aviso } from "./aviso";
import { Button } from "./button";
import { Campo, Entrada } from "./campo";

export const MENSAJE_RANGO_INVERTIDO = "La fecha inicial no puede ser posterior a la final.";

/**
 * El filtro de fechas de toda pantalla con rango (UI Etapa 1, spec §4.3): Desde, Hasta,
 * los atajos y el botón **Mostrar**. Los atajos solo cambian las fechas: consultar
 * sigue siendo Mostrar. `children` son los demás filtros de la pantalla (van antes de
 * Mostrar) y `acciones` lo que va después (el botón de Excel).
 */
export function FiltroFechas({
  id,
  desde,
  hasta,
  onCambio,
  onMostrar,
  deshabilitado = false,
  children,
  acciones,
}: {
  id: string;
  desde: string;
  hasta: string;
  onCambio: (rango: RangoFechas) => void;
  onMostrar: (rango: RangoFechas) => void;
  deshabilitado?: boolean;
  children?: ReactNode;
  acciones?: ReactNode;
}) {
  const [error, setError] = useState<string | null>(null);
  const hoy = hoyEnTijuana();
  const ayer = diaAnterior(hoy);
  const atajos: { texto: string; rango: RangoFechas }[] = [
    { texto: "Hoy", rango: { desde: hoy, hasta: hoy } },
    { texto: "Ayer", rango: { desde: ayer, hasta: ayer } },
    { texto: "Esta semana", rango: rangoSemana(hoy) },
    { texto: "Este mes", rango: rangoMes(hoy) },
  ];

  function alEnviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (desde > hasta) {
      setError(MENSAJE_RANGO_INVERTIDO);
      return;
    }
    setError(null);
    onMostrar({ desde, hasta });
  }

  return (
    <div className="flex flex-col gap-3">
      <form onSubmit={alEnviar} className="flex flex-wrap items-end gap-3 rounded-[10px] border p-3.5">
        <Campo id={`${id}-desde`} etiqueta="Desde">
          <Entrada type="date" required value={desde} onChange={(e) => onCambio({ desde: e.target.value, hasta })} />
        </Campo>
        <Campo id={`${id}-hasta`} etiqueta="Hasta">
          <Entrada type="date" required value={hasta} onChange={(e) => onCambio({ desde, hasta: e.target.value })} />
        </Campo>
        <div role="group" aria-label="Atajos de fechas" className="flex items-center gap-0.5">
          {atajos.map((a) => (
            <Button
              key={a.texto}
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setError(null);
                onCambio(a.rango);
              }}
            >
              {a.texto}
            </Button>
          ))}
        </div>
        {children}
        <Button type="submit" disabled={deshabilitado}>
          Mostrar
        </Button>
        {acciones}
      </form>
      {error && <Aviso tono="error">{error}</Aviso>}
    </div>
  );
}
