"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { useEnvioFormulario } from "@/components/catalogo/use-envio-formulario";
import { leerMontoCentavos, textoMonto } from "@/lib/cobranzas";
import {
  crearMovimiento,
  editarMovimiento,
  etiquetaSucursalCuenta,
  ETIQUETA_TIPO,
  type CuentaTesoreria,
  type MovimientoManual,
  type TipoMovimiento,
} from "@/lib/tesoreria";
import { hoyEnTijuana } from "@/lib/ventas";

const CLASE = "rounded-md border px-3 py-2 text-sm";

interface Props {
  cuentas: CuentaTesoreria[];
  /** null = alta. Al editar, el tipo no cambia (spec §3.1). */
  movimiento: MovimientoManual | null;
  alGuardar: () => void;
  alCancelar?: () => void;
}

/** Registrar operación (T-29): depósito, retiro o traspaso de una cuenta a otra. */
export function FormularioMovimiento({ cuentas, movimiento, alGuardar, alCancelar }: Props) {
  const hoy = hoyEnTijuana();
  const [tipo, setTipo] = useState<TipoMovimiento>(movimiento?.tipo ?? "deposito");
  const [fecha, setFecha] = useState(movimiento?.fecha ?? hoy);
  const [cuentaId, setCuentaId] = useState(movimiento?.cuentaId ?? "");
  const [destinoId, setDestinoId] = useState(movimiento?.cuentaDestinoId ?? "");
  const [monto, setMonto] = useState(movimiento ? textoMonto(movimiento.montoCentavos) : "");
  const [comentario, setComentario] = useState(movimiento?.comentario ?? "");
  const [tocado, setTocado] = useState(false);
  const { enviando, error, enviar } = useEnvioFormulario("No se pudo guardar el movimiento.");

  const centavos = leerMontoCentavos(monto);
  const problema =
    cuentaId === ""
      ? tipo === "traspaso" ? "Elige la cuenta de la que sale." : "Elige la cuenta."
      : tipo === "traspaso" && destinoId === ""
        ? "Elige la cuenta a la que entra."
        : tipo === "traspaso" && destinoId === cuentaId
          ? "Elige dos cuentas distintas."
          : centavos === null
            ? "Escribe un monto mayor a $0."
            : fecha === ""
              ? "Elige la fecha."
              : fecha > hoy
              ? "La fecha no puede ser futura."
              : null;

  const opciones = cuentas.map((c) => (
    <option key={c.id} value={c.id}>
      {c.nombre} · {etiquetaSucursalCuenta(c.sucursalCodigo)}
    </option>
  ));
  // Al editar, la cuenta del movimiento puede no estar en la lista (borrada o de otra sucursal): se muestra igual.
  const fantasma = (id: string | null | undefined, nombre: string | null | undefined) =>
    movimiento && id && !cuentas.some((c) => c.id === id) ? (
      <option key={`fantasma-${id}`} value={id}>
        {nombre ?? "Cuenta no disponible"}
      </option>
    ) : null;

  async function alEnviar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (problema || centavos === null) return;
    const comun = {
      fecha,
      montoCentavos: centavos,
      cuentaId,
      ...(tipo === "traspaso" ? { cuentaDestinoId: destinoId } : {}),
    };
    // Al editar solo se mandan las cuentas que el usuario cambió.
    const cambios = {
      fecha,
      montoCentavos: centavos,
      ...(movimiento && cuentaId !== movimiento.cuentaId ? { cuentaId } : {}),
      ...(movimiento && tipo === "traspaso" && destinoId !== movimiento.cuentaDestinoId ? { cuentaDestinoId: destinoId } : {}),
    };
    await enviar(
      () =>
        movimiento
          ? editarMovimiento(movimiento.id, { ...cambios, comentario: comentario.trim() })
          : crearMovimiento({ tipo, ...comun, ...(comentario.trim() ? { comentario: comentario.trim() } : {}) }),
      () => {
        if (!movimiento) {
          setMonto("");
          setComentario("");
          setTocado(false);
        }
        alGuardar();
      },
    );
  }

  return (
    <form onSubmit={alEnviar} onChange={() => setTocado(true)} className="flex flex-col gap-4 rounded-md border p-4">
      <h3 className="text-sm font-semibold">{movimiento ? `Editar ${ETIQUETA_TIPO[movimiento.tipo].toLowerCase()}` : "Registrar operación"}</h3>
      <div className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="mov-tipo" className="text-sm font-medium">Tipo</label>
          <select id="mov-tipo" className={CLASE} value={tipo} disabled={enviando || movimiento !== null} onChange={(e) => setTipo(e.target.value as TipoMovimiento)}>
            <option value="deposito">Depósito</option>
            <option value="retiro">Retiro</option>
            <option value="traspaso">Traspaso</option>
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="mov-fecha" className="text-sm font-medium">Fecha</label>
          <input id="mov-fecha" type="date" className={CLASE} max={hoy} value={fecha} disabled={enviando} onChange={(e) => setFecha(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="mov-cuenta" className="text-sm font-medium">{tipo === "traspaso" ? "De" : "Cuenta"}</label>
          <select id="mov-cuenta" className={`${CLASE} w-64`} value={cuentaId} disabled={enviando} onChange={(e) => setCuentaId(e.target.value)}>
            <option value="">Elige…</option>
            {opciones}
            {fantasma(movimiento?.cuentaId, movimiento?.cuentaNombre)}
          </select>
        </div>
        {tipo === "traspaso" && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="mov-destino" className="text-sm font-medium">A</label>
            <select id="mov-destino" className={`${CLASE} w-64`} value={destinoId} disabled={enviando} onChange={(e) => setDestinoId(e.target.value)}>
              <option value="">Elige…</option>
              {opciones}
              {fantasma(movimiento?.cuentaDestinoId, movimiento?.cuentaDestinoNombre)}
            </select>
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="mov-monto" className="text-sm font-medium">Monto</label>
          <input id="mov-monto" inputMode="decimal" className={`${CLASE} w-36 text-right tabular-nums`} value={monto} disabled={enviando} onChange={(e) => setMonto(e.target.value)} />
        </div>
        <div className="flex min-w-48 flex-1 flex-col gap-1.5">
          <label htmlFor="mov-comentario" className="text-sm font-medium">Comentario</label>
          <input id="mov-comentario" maxLength={200} className={CLASE} value={comentario} disabled={enviando} onChange={(e) => setComentario(e.target.value)} />
        </div>
      </div>
      {problema && <p className={`text-sm ${tocado ? "text-destructive" : "text-muted-foreground"}`}>{problema}</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={enviando || problema !== null}>
          {enviando ? "Guardando…" : movimiento ? "Guardar" : "Registrar"}
        </Button>
        {alCancelar && (
          <Button type="button" variant="outline" disabled={enviando} onClick={alCancelar}>
            Cancelar
          </Button>
        )}
      </div>
    </form>
  );
}
