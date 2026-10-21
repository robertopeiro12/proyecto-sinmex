"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Aviso } from "@/components/ui/aviso";
import { Button } from "@/components/ui/button";
import { Campo, Entrada, Lista } from "@/components/ui/campo";
import { useAuth } from "@/components/auth/auth-provider";
import { useEnvioFormulario } from "@/components/catalogo/use-envio-formulario";
import { listarSucursales, type Sucursal } from "@/lib/sucursales";
import {
  crearCuentaTesoreria,
  etiquetaSucursalCuenta,
  renombrarCuentaTesoreria,
  type CuentaTesoreria,
} from "@/lib/tesoreria";

interface Props {
  cuenta: CuentaTesoreria | null;
  alGuardar: () => void;
  alCancelar: () => void;
}

/** Alta y renombrar. La sucursal se elige solo al dar de alta y solo un General (spec §3.1–3.2). */
export function FormularioCuentaTesoreria({ cuenta, alGuardar, alCancelar }: Props) {
  const { usuario } = useAuth();
  const esAlta = cuenta === null;
  const eligeSucursal = esAlta && usuario !== null && usuario.sucursal === null;
  const [nombre, setNombre] = useState(cuenta?.nombre ?? "");
  // "" = sin elegir; "general" = sin sucursal; si no, el id.
  const [destino, setDestino] = useState("");
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  const { enviando, error, enviar } = useEnvioFormulario("No se pudo guardar la cuenta.");

  useEffect(() => {
    if (!eligeSucursal) return;
    let vigente = true;
    void listarSucursales()
      .then((lista) => {
        if (vigente) setSucursales(lista.filter((s) => s.activa));
      })
      .catch(() => {});
    return () => {
      vigente = false;
    };
  }, [eligeSucursal]);

  async function alEnviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    await enviar(
      () =>
        cuenta
          ? renombrarCuentaTesoreria(cuenta.id, nombre)
          : crearCuentaTesoreria({
              nombre,
              ...(eligeSucursal && destino !== "general" ? { sucursalId: destino } : {}),
            }),
      alGuardar,
    );
  }

  return (
    <form onSubmit={alEnviar} className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-4">
        <Campo id="cuenta-nombre" etiqueta="Nombre de la cuenta" className="flex-1">
          <Entrada
            required
            maxLength={60}
            disabled={enviando}
            placeholder="Efectivo, Caja Chica, ScotiaFiscal…"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
          />
        </Campo>

        {eligeSucursal && (
          <Campo id="cuenta-sucursal" etiqueta="Sucursal">
            <Lista
              required
              disabled={enviando}
              value={destino}
              onChange={(e) => setDestino(e.target.value)}
              className="w-64"
            >
              <option value="">Elige…</option>
              <option value="general">General (toda la empresa)</option>
              {sucursales.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.codigo} · {s.nombre}
                </option>
              ))}
            </Lista>
          </Campo>
        )}
      </div>

      {!esAlta && (
        <p className="text-xs text-muted-foreground">
          Sucursal: {etiquetaSucursalCuenta(cuenta.sucursalCodigo)}. La sucursal de una cuenta no se puede cambiar.
        </p>
      )}

      {error && <Aviso tono="error">{error}</Aviso>}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" disabled={enviando} onClick={alCancelar}>
          Cancelar
        </Button>
        <Button type="submit" disabled={enviando || (eligeSucursal && destino === "")}>
          {enviando ? "Guardando…" : "Guardar"}
        </Button>
      </div>
    </form>
  );
}
