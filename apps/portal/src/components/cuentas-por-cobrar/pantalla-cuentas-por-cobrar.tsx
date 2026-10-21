"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { Aviso } from "@/components/ui/aviso";
import { BotonExcel } from "@/components/ui/boton-excel";
import { Casilla } from "@/components/ui/campo";
import { EncabezadoPantalla, Pantalla } from "@/components/ui/encabezado-pantalla";
import { EstadoPantalla } from "@/components/ui/estado-pantalla";
import { mensajeDe } from "@/lib/api";
import {
  definicionExcelCuentasPorCobrar,
  obtenerCuentasPorCobrar,
  type CuentasPorCobrar,
} from "@/lib/cuentas-por-cobrar";
import { exportarExcel } from "@/lib/excel/exportar";
import { etiquetaSucursal } from "@/lib/reportes";
import { plural } from "@/lib/formato";
import { formatearPesos } from "@/lib/ventas";
import { TablaCuentasPorCobrar } from "./tabla-cuentas-por-cobrar";

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

  // Mientras /auth/me no contesta, `puede()` da false a todos (como PantallaKilometraje).
  if (cargandoSesion) return <EstadoPantalla titulo="Cuentas por Cobrar" tipo="cargando" />;
  if (!permitido) return <EstadoPantalla titulo="Cuentas por Cobrar" tipo="sin-permiso" />;

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

  // Refetch (p. ej. al marcar Solo vencidas): lo viejo sigue a la vista, atenuado.
  const actualizando = cargando && datos !== null;
  const hayNotas = datos !== null && datos.clientes.length > 0;

  return (
    <Pantalla>
      <EncabezadoPantalla
        titulo="Cuentas por Cobrar"
        descripcion="Cuánto debe cada cliente, con sus notas pendientes y vencidas."
        acciones={<BotonExcel exportando={exportando} disabled={!hayNotas || cargando} onClick={() => void alExportar()} />}
      />

      <div className="flex flex-wrap items-center gap-4 rounded-[10px] border p-3.5">
        <Casilla
          etiqueta="Solo vencidas"
          checked={soloVencidas}
          onChange={(e) => setSoloVencidas(e.target.checked)}
        />
      </div>

      {error && <Aviso tono="error">{error}</Aviso>}

      {actualizando && <p className="text-sm text-muted-foreground">Actualizando…</p>}

      {datos && (
        <div
          data-testid="totales-cuentas"
          aria-busy={actualizando}
          className={`flex flex-wrap gap-8 ${actualizando ? "opacity-60" : ""}`}
        >
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

      {cargando && !datos && <p className="text-sm text-muted-foreground">Cargando…</p>}

      {datos && (
        <div data-testid="tabla-cuentas" aria-busy={actualizando} className={actualizando ? "opacity-60" : undefined}>
          {hayNotas ? (
            <TablaCuentasPorCobrar
              clientes={datos.clientes}
              sucursal={sucursal}
              puedeCobrar={puede("cobranza.registrar")}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              {consultadoConVencidas ? "No hay notas vencidas." : "No hay cuentas por cobrar."}
            </p>
          )}
        </div>
      )}
    </Pantalla>
  );
}
