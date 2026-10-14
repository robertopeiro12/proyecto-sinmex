"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/components/auth/auth-provider";
import { mensajeDe } from "@/lib/api";
import {
  definicionExcelCuentasPorCobrar,
  obtenerCuentasPorCobrar,
  type CuentasPorCobrar,
} from "@/lib/cuentas-por-cobrar";
import { exportarExcel } from "@/lib/excel/exportar";
import { etiquetaSucursal } from "@/lib/reportes";
import { formatearPesos } from "@/lib/ventas";
import { TablaCuentasPorCobrar } from "./tabla-cuentas-por-cobrar";

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

/**
 * Operación → Cuentas por Cobrar (T-22). La página monta este componente con
 * `key={sucursal}`: cambiar el selector global de sucursal empieza limpio.
 */
export function PantallaCuentasPorCobrar({ sucursal }: { sucursal: string | null }) {
  const { puede, usuario, cargando: cargandoSesion } = useAuth();
  const permitido = puede("cuentas_cobrar.ver");
  const [soloVencidas, setSoloVencidas] = useState(false);
  const [datos, setDatos] = useState<CuentasPorCobrar | null>(null);
  const [consultadoConVencidas, setConsultadoConVencidas] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [exportando, setExportando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Solo la última petición escribe: una lenta que llega tarde no pisa a la nueva.
  const ultima = useRef(0);

  useEffect(() => {
    if (!permitido) return;
    const esta = ++ultima.current;
    setCargando(true);
    setError(null);
    obtenerCuentasPorCobrar({ sucursal, soloVencidas }).then(
      (respuesta) => {
        if (esta !== ultima.current) return;
        setDatos(respuesta);
        setConsultadoConVencidas(soloVencidas);
        setCargando(false);
      },
      (err: unknown) => {
        if (esta !== ultima.current) return;
        setDatos(null);
        setError(mensajeDe(err, "No se pudieron cargar las cuentas por cobrar."));
        setCargando(false);
      },
    );
  }, [permitido, sucursal, soloVencidas]);

  if (cargandoSesion) {
    // Mientras /auth/me no contesta, `puede()` da false a todos (como PantallaKilometraje).
    return (
      <Card>
        <CardHeader>
          <CardTitle>Cuentas por Cobrar</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Cargando…</p>
        </CardContent>
      </Card>
    );
  }

  if (!permitido) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Cuentas por Cobrar</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No tienes permiso para ver cuentas por cobrar</p>
        </CardContent>
      </Card>
    );
  }

  async function alExportar() {
    if (!datos) return;
    setError(null);
    setExportando(true);
    try {
      await exportarExcel(
        definicionExcelCuentasPorCobrar(datos, {
          sucursal: etiquetaSucursal(usuario?.sucursal?.codigo ?? null, sucursal),
          soloVencidas: consultadoConVencidas,
        }),
      );
    } catch {
      setError("No se pudo generar el Excel.");
    } finally {
      setExportando(false);
    }
  }

  const hayNotas = datos !== null && datos.clientes.length > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Cuentas por Cobrar</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {datos && (
          <div className="flex flex-wrap gap-8">
            <div>
              <p className="text-sm text-muted-foreground">Total por cobrar</p>
              <p className="text-2xl font-semibold" data-total="total">{formatearPesos(datos.totalCentavos)}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Vencido</p>
              <p
                className={`text-2xl font-semibold ${datos.vencidoCentavos > 0 ? "text-destructive" : ""}`}
                data-total="vencido"
              >
                {formatearPesos(datos.vencidoCentavos)}
              </p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Notas</p>
              <p className="text-2xl font-semibold">
                {plural(datos.notas, "nota", "notas")} de {plural(datos.clientes.length, "cliente", "clientes")}
              </p>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={soloVencidas} onChange={(e) => setSoloVencidas(e.target.checked)} />
            Solo vencidas
          </label>
          <Button
            type="button"
            variant="outline"
            disabled={!hayNotas || exportando || cargando}
            onClick={() => void alExportar()}
          >
            Exportar a Excel
          </Button>
        </div>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        {cargando && !datos && <p className="text-sm text-muted-foreground">Cargando…</p>}

        {datos &&
          (hayNotas ? (
            <TablaCuentasPorCobrar
              clientes={datos.clientes}
              sucursal={sucursal}
              puedeCobrar={puede("cobranza.registrar")}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              {consultadoConVencidas ? "No hay notas vencidas." : "No hay cuentas por cobrar."}
            </p>
          ))}
      </CardContent>
    </Card>
  );
}
