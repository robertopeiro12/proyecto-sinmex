"use client";

import { useState, type FormEvent } from "react";
import { Aviso } from "@/components/ui/aviso";
import { Button } from "@/components/ui/button";
import { Campo, Entrada, Lista } from "@/components/ui/campo";
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

interface Props {
  cuentas: CuentaTesoreria[];
  /** null = alta. Al editar, el tipo no cambia (spec §3.1). */
  movimiento: MovimientoManual | null;
  alGuardar: () => void;
  alCancelar?: () => void;
  /** Dentro de la ventana de edición el título lo pone `Ventana`. */
  sinTitulo?: boolean;
}

/** Registrar operación (T-29): depósito, retiro o traspaso de una cuenta a otra. */
export function FormularioMovimiento({ cuentas, movimiento, alGuardar, alCancelar, sinTitulo = false }: Props) {
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

  // El de arriba y el de la ventana de edición están a la vez en pantalla: ids distintos.
  const id = movimiento ? "mov-editar" : "mov";

  return (
    <form onSubmit={alEnviar} onChange={() => setTocado(true)} className={`flex flex-col gap-4 ${sinTitulo ? "" : "rounded-[10px] border p-4"}`}>
      {!sinTitulo && <h2 className="text-sm font-semibold">{movimiento ? `Editar ${ETIQUETA_TIPO[movimiento.tipo].toLowerCase()}` : "Registrar operación"}</h2>}
      <div className="flex flex-wrap items-end gap-4">
        <Campo id={`${id}-tipo`} etiqueta="Tipo">
          <Lista value={tipo} disabled={enviando || movimiento !== null} onChange={(e) => setTipo(e.target.value as TipoMovimiento)}>
            <option value="deposito">Depósito</option>
            <option value="retiro">Retiro</option>
            <option value="traspaso">Traspaso</option>
          </Lista>
        </Campo>
        <Campo id={`${id}-fecha`} etiqueta="Fecha">
          <Entrada type="date" max={hoy} value={fecha} disabled={enviando} onChange={(e) => setFecha(e.target.value)} />
        </Campo>
        <Campo id={`${id}-cuenta`} etiqueta={tipo === "traspaso" ? "De" : "Cuenta"}>
          <Lista className="w-64" value={cuentaId} disabled={enviando} onChange={(e) => setCuentaId(e.target.value)}>
            <option value="">Elige…</option>
            {opciones}
            {fantasma(movimiento?.cuentaId, movimiento?.cuentaNombre)}
          </Lista>
        </Campo>
        {tipo === "traspaso" && (
          <Campo id={`${id}-destino`} etiqueta="A">
            <Lista className="w-64" value={destinoId} disabled={enviando} onChange={(e) => setDestinoId(e.target.value)}>
              <option value="">Elige…</option>
              {opciones}
              {fantasma(movimiento?.cuentaDestinoId, movimiento?.cuentaDestinoNombre)}
            </Lista>
          </Campo>
        )}
        <Campo id={`${id}-monto`} etiqueta="Monto">
          <Entrada inputMode="decimal" className="w-36 text-right tabular-nums" value={monto} disabled={enviando} onChange={(e) => setMonto(e.target.value)} />
        </Campo>
        <Campo id={`${id}-comentario`} etiqueta="Comentario" className="min-w-48 flex-1">
          <Entrada maxLength={200} value={comentario} disabled={enviando} onChange={(e) => setComentario(e.target.value)} />
        </Campo>
      </div>
      {problema && <p className={`text-sm ${tocado ? "text-destructive" : "text-muted-foreground"}`}>{problema}</p>}
      {error && <Aviso tono="error">{error}</Aviso>}
      <div className="flex justify-end gap-2">
        {alCancelar && (
          <Button type="button" variant="outline" disabled={enviando} onClick={alCancelar}>
            Cancelar
          </Button>
        )}
        <Button type="submit" disabled={enviando || problema !== null}>
          {enviando ? "Guardando…" : movimiento ? "Guardar" : "Registrar"}
        </Button>
      </div>
    </form>
  );
}
