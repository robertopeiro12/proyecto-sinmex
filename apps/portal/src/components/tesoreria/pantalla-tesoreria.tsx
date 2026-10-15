"use client";

import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/components/auth/auth-provider";
import { PestanaCuentas } from "./pestana-cuentas";
import { PestanaSaldos } from "./pestana-saldos";
import { PestanaVista } from "./pestana-vista";

type Pestana = "tesoreria" | "cuentas" | "saldos";
const TODAS: { clave: Pestana; texto: string; permiso: string }[] = [
  { clave: "tesoreria", texto: "Tesorería", permiso: "tesoreria.ver" },
  { clave: "cuentas", texto: "Cuentas", permiso: "tesoreria.gestionar" },
  { clave: "saldos", texto: "Saldos", permiso: "tesoreria.gestionar" },
];

/** Finanzas → Tesorería (T-28): ver, cuentas y saldos fijados. Pestañas como Facturas (T-19). */
export function PantallaTesoreria({
  sucursal,
  vistaInicial,
}: {
  sucursal: string | null;
  vistaInicial: string | null;
}) {
  const { puede, cargando } = useAuth();
  const pestanas = TODAS.filter((p) => puede(p.permiso));
  const [elegida, setElegida] = useState<Pestana | null>(null);
  const botones = useRef<Partial<Record<Pestana, HTMLButtonElement | null>>>({});

  if (cargando) return <Marco>Cargando…</Marco>;
  if (pestanas.length === 0) return <Marco>No tienes permiso para ver la Tesorería</Marco>;

  // La de la URL si se puede ver; si no, la primera permitida.
  const actual: Pestana =
    elegida ?? pestanas.find((p) => p.clave === vistaInicial)?.clave ?? pestanas[0].clave;

  function cambiar(clave: Pestana) {
    setElegida(clave);
    const params = new URLSearchParams(window.location.search);
    params.set("vista", clave);
    window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
  }

  function alTeclear(evento: KeyboardEvent<HTMLDivElement>) {
    if (evento.key !== "ArrowLeft" && evento.key !== "ArrowRight") return;
    evento.preventDefault();
    const i = pestanas.findIndex((p) => p.clave === actual);
    const paso = evento.key === "ArrowRight" ? 1 : pestanas.length - 1;
    const siguiente = pestanas[(i + paso) % pestanas.length].clave;
    cambiar(siguiente);
    botones.current[siguiente]?.focus();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tesorería</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div role="tablist" className="flex gap-2" onKeyDown={alTeclear}>
          {pestanas.map(({ clave, texto }) => (
            <button
              key={clave}
              type="button"
              role="tab"
              id={`pestana-${clave}`}
              aria-controls={`panel-${clave}`}
              aria-selected={actual === clave}
              tabIndex={actual === clave ? 0 : -1}
              ref={(el) => {
                botones.current[clave] = el;
              }}
              onClick={() => cambiar(clave)}
              className={`rounded-md border px-3 py-1.5 text-sm ${actual === clave ? "bg-muted font-medium" : ""}`}
            >
              {texto}
            </button>
          ))}
        </div>
        {/* La vista se queda montada para no perder el rango; Cuentas y Saldos se montan al abrirse. */}
        {pestanas.map(({ clave }) => (
          <div key={clave} role="tabpanel" id={`panel-${clave}`} aria-labelledby={`pestana-${clave}`} hidden={actual !== clave}>
            {clave === "tesoreria" && <PestanaVista sucursal={sucursal} />}
            {clave === "cuentas" && actual === clave && <PestanaCuentas sucursal={sucursal} />}
            {clave === "saldos" && actual === clave && <PestanaSaldos sucursal={sucursal} />}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function Marco({ children }: { children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Tesorería</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">{children}</p>
      </CardContent>
    </Card>
  );
}
