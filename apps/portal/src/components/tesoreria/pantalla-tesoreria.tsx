"use client";

import { useState, type ReactNode } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { EncabezadoPantalla, Pantalla } from "@/components/ui/encabezado-pantalla";
import { EstadoPantalla } from "@/components/ui/estado-pantalla";
import { Pestanas } from "@/components/ui/pestanas";
import { PestanaCuentas } from "./pestana-cuentas";
import { PestanaMovimientos } from "./pestana-movimientos";
import { PestanaSaldos } from "./pestana-saldos";
import { PestanaVista } from "./pestana-vista";

type Clave = "tesoreria" | "movimientos" | "cuentas" | "saldos";
const TODAS: { clave: Clave; texto: string; permiso: string }[] = [
  { clave: "tesoreria", texto: "Tesorería", permiso: "tesoreria.ver" },
  { clave: "movimientos", texto: "Movimientos", permiso: "tesoreria.gestionar" },
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
  const permitidas = TODAS.filter((p) => puede(p.permiso));
  const [elegida, setElegida] = useState<Clave | null>(null);

  if (cargando) return <EstadoPantalla titulo="Tesorería" tipo="cargando" />;
  if (permitidas.length === 0) return <EstadoPantalla titulo="Tesorería" tipo="sin-permiso" />;

  // La de la URL si se puede ver; si no, la primera permitida.
  const inicial: Clave = permitidas.find((p) => p.clave === vistaInicial)?.clave ?? permitidas[0].clave;
  const actual = elegida ?? inicial;

  function alCambiarPestana(valor: string) {
    const clave = permitidas.find((p) => p.clave === valor)?.clave;
    if (!clave) return;
    setElegida(clave);
    const params = new URLSearchParams(window.location.search);
    params.set("vista", clave);
    window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
  }

  // La vista se queda montada para no perder el rango; las demás se montan al abrirse y se
  // desmontan al salir, como antes.
  const contenido: Record<Clave, ReactNode> = {
    tesoreria: <PestanaVista sucursal={sucursal} activa={actual === "tesoreria"} />,
    movimientos: actual === "movimientos" ? <PestanaMovimientos sucursal={sucursal} /> : null,
    cuentas: actual === "cuentas" ? <PestanaCuentas sucursal={sucursal} /> : null,
    saldos: actual === "saldos" ? <PestanaSaldos sucursal={sucursal} /> : null,
  };

  return (
    <Pantalla>
      <EncabezadoPantalla
        titulo="Tesorería"
        descripcion="Las cuentas del negocio con su saldo, sus depósitos, retiros y traspasos, y la cobranza que entra sola."
      />
      <Pestanas
        etiqueta="Tesorería"
        conservarMontadas
        valorInicial={inicial}
        onCambio={alCambiarPestana}
        pestanas={permitidas.map((p) => ({ valor: p.clave, etiqueta: p.texto, contenido: contenido[p.clave] }))}
      />
    </Pantalla>
  );
}
