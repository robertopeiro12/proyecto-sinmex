"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/auth-provider";
import { EncabezadoPantalla, Pantalla } from "@/components/ui/encabezado-pantalla";
import { EstadoPantalla } from "@/components/ui/estado-pantalla";
import { BuscarPorCobrar } from "./buscar-por-cobrar";
import { CobranzaCliente } from "./cobranza-cliente";

type Vista = { tipo: "buscar" } | { tipo: "cliente"; clienteId: string; notaId: string | null };

/** Operación → Cobranza (T-21): buscar la cuenta por cobrar y registrar el pago.
 *  Con `clienteInicial` (desde Cuentas por Cobrar, T-22) abre directo ese cliente. */
export function PantallaCobranza({
  sucursal,
  clienteInicial = null,
  notaInicial = null,
}: {
  sucursal: string | null;
  clienteInicial?: string | null;
  notaInicial?: string | null;
}) {
  const router = useRouter();
  const { puede, cargando: cargandoSesion } = useAuth();
  const [vista, setVista] = useState<Vista>(() =>
    clienteInicial
      ? { tipo: "cliente", clienteId: clienteInicial, notaId: notaInicial }
      : { tipo: "buscar" },
  );

  // Mientras /auth/me no contesta, `puede()` da false a todos: sin esto, quien
  // si tiene el permiso ve "No tienes permiso" un instante (como PantallaPerfiles).
  if (cargandoSesion) return <EstadoPantalla titulo="Cobranza" tipo="cargando" />;

  if (!puede("cobranza.registrar")) return <EstadoPantalla titulo="Cobranza" tipo="sin-permiso" />;

  if (vista.tipo === "cliente") {
    return (
      <CobranzaCliente
        clienteId={vista.clienteId}
        notaInicial={vista.notaId}
        onVolver={() => {
          setVista({ tipo: "buscar" });
          // Si venía de Cuentas por Cobrar, ?cliente=&nota= seguiría en la dirección y
          // cambiar de sucursal (o recargar) reabriría al cliente viejo: se quitan.
          if (clienteInicial) {
            router.replace(
              sucursal
                ? `/operacion/cobranza?${new URLSearchParams({ sucursal })}`
                : "/operacion/cobranza",
            );
          }
        }}
      />
    );
  }

  return (
    <Pantalla>
      <EncabezadoPantalla
        titulo="Cobranza"
        descripcion="Busca la cuenta por cobrar por cliente, por fecha de la venta o por # de nota, y registra su pago."
      />
      <BuscarPorCobrar
        sucursal={sucursal}
        onElegir={(clienteId, notaId) => setVista({ tipo: "cliente", clienteId, notaId })}
      />
    </Pantalla>
  );
}
