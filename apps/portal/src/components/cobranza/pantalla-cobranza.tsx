"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/components/auth/auth-provider";
import { BuscarPorCobrar } from "./buscar-por-cobrar";
import { CobranzaCliente } from "./cobranza-cliente";

type Vista = { tipo: "buscar" } | { tipo: "cliente"; clienteId: string; notaId: string | null };

/** Operación → Cobranza (T-21): buscar la cuenta por cobrar y registrar el pago. */
export function PantallaCobranza({ sucursal }: { sucursal: string | null }) {
  const { puede } = useAuth();
  const [vista, setVista] = useState<Vista>({ tipo: "buscar" });

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
