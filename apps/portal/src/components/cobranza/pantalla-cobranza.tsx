"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/components/auth/auth-provider";
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
  const { puede, cargando: cargandoSesion } = useAuth();
  const [vista, setVista] = useState<Vista>(() =>
    clienteInicial
      ? { tipo: "cliente", clienteId: clienteInicial, notaId: notaInicial }
      : { tipo: "buscar" },
  );

  if (cargandoSesion) {
    // Mientras /auth/me no contesta, `puede()` da false a todos: sin esto, quien
    // si tiene el permiso ve "No tienes permiso" un instante (como PantallaPerfiles).
    return (
      <Card>
        <CardHeader>
          <CardTitle>Cobranza</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Cargando…</p>
        </CardContent>
      </Card>
    );
  }

  if (!puede("cobranza.registrar")) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Cobranza</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No tienes permiso para registrar cobranza</p>
        </CardContent>
      </Card>
    );
  }

  if (vista.tipo === "cliente") {
    return (
      <CobranzaCliente
        clienteId={vista.clienteId}
        notaInicial={vista.notaId}
        onVolver={() => setVista({ tipo: "buscar" })}
      />
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Cobranza</CardTitle>
      </CardHeader>
      <CardContent>
        <BuscarPorCobrar
          sucursal={sucursal}
          onElegir={(clienteId, notaId) => setVista({ tipo: "cliente", clienteId, notaId })}
        />
      </CardContent>
    </Card>
  );
}
