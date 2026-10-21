"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Aviso } from "@/components/ui/aviso";
import { Button } from "@/components/ui/button";
import { useConfirmar } from "@/components/ui/confirmar";
import { FiltroFechas } from "@/components/ui/filtro-fechas";
import { CajaTabla, FilaVacia, Tabla, Td, TdMonto, Th } from "@/components/ui/tabla";
import { Ventana } from "@/components/ui/ventana";
import { mensajeDe } from "@/lib/api";
import { primerDiaDelMes, type RangoFechas } from "@/lib/fechas";
import { formatearFecha } from "@/lib/reportes";
import {
  eliminarMovimiento,
  ETIQUETA_TIPO,
  listarCuentasTesoreria,
  listarMovimientos,
  type CuentaTesoreria,
  type MovimientoManual,
} from "@/lib/tesoreria";
import { formatearPesos, hoyEnTijuana } from "@/lib/ventas";
import { FormularioMovimiento } from "./formulario-movimiento";

/** Registrar operación (T-29): formulario arriba y los movimientos del rango abajo. */
export function PestanaMovimientos({ sucursal }: { sucursal: string | null }) {
  const hoy = hoyEnTijuana();
  // `rango` es lo que se teclea; `consultado`, lo que se pidió con Mostrar (y lo que recarga tras guardar).
  const [rango, setRango] = useState<RangoFechas>({ desde: primerDiaDelMes(hoy), hasta: hoy });
  const [consultado, setConsultado] = useState<RangoFechas>(rango);
  const { confirmar, ventana } = useConfirmar();
  const [cuentas, setCuentas] = useState<CuentaTesoreria[]>([]);
  const [movimientos, setMovimientos] = useState<MovimientoManual[] | null>(null);
  const [editando, setEditando] = useState<MovimientoManual | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ultima = useRef(0);

  const cargar = useCallback(async () => {
    const esta = ++ultima.current;
    setError(null);
    try {
      const lista = await listarMovimientos({ desde: consultado.desde, hasta: consultado.hasta, sucursal });
      if (esta === ultima.current) setMovimientos(lista);
    } catch (err) {
      if (esta === ultima.current) setError(mensajeDe(err, "No se pudieron cargar los movimientos."));
    }
  }, [consultado, sucursal]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  useEffect(() => {
    let vigente = true;
    listarCuentasTesoreria(sucursal).then(
      (l) => vigente && setCuentas(l),
      () => vigente && setError("No se pudieron cargar las cuentas."),
    );
    return () => {
      vigente = false;
    };
  }, [sucursal]);

  async function alEliminar(m: MovimientoManual) {
    const tipo = ETIQUETA_TIPO[m.tipo].toLowerCase();
    const si = await confirmar({
      titulo: `¿Eliminar el ${tipo} de ${formatearPesos(m.montoCentavos)} del ${formatearFecha(m.fecha)}?`,
      descripcion: "No se puede deshacer.",
      confirmar: "Eliminar movimiento",
    });
    if (!si) return;
    try {
      await eliminarMovimiento(m.id);
      void cargar();
    } catch (err) {
      setError(mensajeDe(err, "No se pudo eliminar el movimiento."));
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Registrar: fijo arriba. Editar va en una ventana, así lo capturado aquí no se pierde. */}
      <FormularioMovimiento
        key="nuevo"
        cuentas={cuentas}
        movimiento={null}
        alGuardar={() => void cargar()}
      />

      <FiltroFechas id="movs" desde={rango.desde} hasta={rango.hasta} onCambio={setRango} onMostrar={setConsultado} />

      {error && <Aviso tono="error">{error}</Aviso>}
      {movimientos === null && !error && <p className="text-sm text-muted-foreground">Cargando…</p>}
      {movimientos !== null && (
        <CajaTabla>
          <Tabla aria-label="Movimientos registrados">
            <thead>
              <tr>
                <Th>Fecha</Th>
                <Th>Tipo</Th>
                <Th>Cuenta</Th>
                <Th alinear="derecha">Monto</Th>
                <Th>Comentario</Th>
                <Th>Capturó</Th>
                <Th><span className="sr-only">Acciones</span></Th>
              </tr>
            </thead>
            <tbody>
              {movimientos.length === 0 && <FilaVacia columnas={7}>No hay movimientos en el rango.</FilaVacia>}
              {movimientos.map((m) => (
                <tr key={m.id}>
                  <Td className="whitespace-nowrap">{formatearFecha(m.fecha)}</Td>
                  <Td className="whitespace-nowrap">{ETIQUETA_TIPO[m.tipo]}</Td>
                  <Td>{m.cuentaDestinoNombre ? `${m.cuentaNombre} → ${m.cuentaDestinoNombre}` : m.cuentaNombre}</Td>
                  <TdMonto centavos={m.tipo === "retiro" ? -m.montoCentavos : m.montoCentavos} />
                  <Td>{m.comentario ?? "—"}</Td>
                  <Td>{m.capturo}</Td>
                  <Td alinear="derecha" className="whitespace-nowrap">
                    {m.editable && (
                      <div className="flex justify-end gap-2">
                        <Button variant="outline" size="sm" onClick={() => setEditando(m)}>Editar</Button>
                        <Button variant="outline" size="sm" onClick={() => void alEliminar(m)}>Eliminar</Button>
                      </div>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Tabla>
        </CajaTabla>
      )}

      <Ventana
        abierta={editando !== null}
        alCerrar={() => setEditando(null)}
        titulo={editando ? `Editar ${ETIQUETA_TIPO[editando.tipo].toLowerCase()}` : ""}
        ancho="ancho"
      >
        {editando && (
          <FormularioMovimiento
            key={editando.id}
            sinTitulo
            cuentas={cuentas}
            movimiento={editando}
            alGuardar={() => {
              setEditando(null);
              void cargar();
            }}
            alCancelar={() => setEditando(null)}
          />
        )}
      </Ventana>
      {ventana}
    </div>
  );
}
