"use client";

import { useEffect, useRef, useState } from "react";
import { Aviso } from "@/components/ui/aviso";
import { Button } from "@/components/ui/button";
import { Campo, Entrada, Lista } from "@/components/ui/campo";
import { mensajeDe } from "@/lib/api";
import {
  METODOS_PAGO_COBRO,
  porCobrarDeCliente,
  type ClientePorCobrar,
  type MetodoPagoCobro,
  type NotaPorCobrar,
} from "@/lib/cobranzas";
import { formatearPesos, plural } from "@/lib/formato";
import { REPARTIDOR_OFICINA } from "@/lib/ventas";
import { useSaldoFavor } from "./aplicar-saldo-favor";
import { usePago } from "./registrar-pago";
import { VistaPreviaCobro } from "./vista-previa-cobro";

/** Lo que salió del recuadro: bien (verde) o lo de la pantalla quedó viejo (ámbar, el 409). */
export type ResultadoCobro = { texto: string; tono: "exito" | "advertencia" };

/** Espera tras la última tecla antes de pedir la vista previa. */
const PAUSA_VISTA_PREVIA_MS = 300;

/** Pide la vista previa sola cuando lo escrito es válido y cambió (`clave`). */
function useVistaPreviaSola(clave: string, valido: boolean, revisar: () => Promise<void>) {
  const ultimo = useRef(revisar);
  useEffect(() => {
    ultimo.current = revisar;
  });
  useEffect(() => {
    if (!valido) return;
    const t = setTimeout(() => void ultimo.current(), PAUSA_VISTA_PREVIA_MS);
    return () => clearTimeout(t);
  }, [clave, valido]);
}

/**
 * *Procesos → Notas*: el cobro de las notas marcadas (spec D2, R3). Es el pago de
 * la vieja *Cobranza* (`usePago`, `useSaldoFavor`: mismo backend, mismo cuerpo,
 * misma vista previa, el mismo 409) con otra cara: la vista previa "Así queda" sale
 * sola y **Cancelar** y **Grabar pago** van juntos abajo a la derecha. Carga las
 * notas por cobrar del cliente al abrirse: una marcada que ya no tiene saldo no
 * entra.
 */
export function RecuadroCobro({
  clienteId,
  notaIds,
  onTerminado,
  onCancelar,
  onSucio,
}: {
  clienteId: string;
  /** Las marcadas con saldo, en el orden en que se ven. */
  notaIds: string[];
  onTerminado: (resultado: ResultadoCobro) => void;
  onCancelar: () => void;
  /** Hay un cobro a medio capturar (Procesos pregunta antes de perderlo). */
  onSucio: (sucio: boolean) => void;
}) {
  const [datos, setDatos] = useState<ClientePorCobrar | null>(null);
  const [error, setError] = useState<string | null>(null);
  const titulo = `Cobrar ${plural(notaIds.length, "nota", "notas")}`;

  useEffect(() => {
    let vigente = true;
    porCobrarDeCliente(clienteId).then(
      (d) => vigente && setDatos(d),
      (err: unknown) => vigente && setError(mensajeDe(err, "No se pudo cargar la cobranza del cliente.")),
    );
    return () => {
      vigente = false;
    };
  }, [clienteId]);

  const palomeadas = datos ? datos.notas.filter((n) => notaIds.includes(n.id)) : [];
  const fuera = datos ? notaIds.length - palomeadas.length : 0;

  return (
    <section aria-label={titulo} className="flex flex-col gap-4 rounded-[10px] border p-5">
      <h3 className="font-semibold">{titulo}</h3>
      {error && <Aviso tono="error">{error}</Aviso>}
      {!datos && !error && <p className="text-sm text-muted-foreground">Cargando…</p>}
      {datos && fuera > 0 && (
        <Aviso tono="advertencia">
          {fuera === 1 ? "Una nota marcada ya no tiene saldo" : `${fuera} notas marcadas ya no tienen saldo`}: no entra en
          este cobro.
        </Aviso>
      )}
      {datos && palomeadas.length > 0 ? (
        <Formas datos={datos} palomeadas={palomeadas} onTerminado={onTerminado} onCancelar={onCancelar} onSucio={onSucio} />
      ) : (
        (error || (datos && palomeadas.length === 0)) && (
          <div className="flex justify-end">
            <Button type="button" variant="outline" onClick={onCancelar}>
              Cancelar
            </Button>
          </div>
        )
      )}
    </section>
  );
}

/** Pago con dinero o, con "Usar saldo a favor", aplicar el saldo a favor. */
function Formas(props: {
  datos: ClientePorCobrar;
  palomeadas: NotaPorCobrar[];
  onTerminado: (resultado: ResultadoCobro) => void;
  onCancelar: () => void;
  onSucio: (sucio: boolean) => void;
}) {
  const [conSaldoFavor, setConSaldoFavor] = useState(false);
  return conSaldoFavor ? (
    <FormaSaldoFavor {...props} onVolver={() => setConSaldoFavor(false)} />
  ) : (
    <FormaPago {...props} onUsarSaldoFavor={() => setConSaldoFavor(true)} />
  );
}

function FormaPago({
  datos,
  palomeadas,
  onTerminado,
  onCancelar,
  onSucio,
  onUsarSaldoFavor,
}: {
  datos: ClientePorCobrar;
  palomeadas: NotaPorCobrar[];
  onTerminado: (resultado: ResultadoCobro) => void;
  onCancelar: () => void;
  onSucio: (sucio: boolean) => void;
  onUsarSaldoFavor: () => void;
}) {
  const pago = usePago({
    cliente: datos,
    palomeadas,
    onRegistrado: (texto) => onTerminado({ texto, tono: "exito" }),
    onDesactualizado: (texto) => onTerminado({ texto, tono: "advertencia" }),
  });
  const problema = pago.problema();
  const valido = problema === null;
  useVistaPreviaSola(pago.clave, valido, pago.revisar);
  const escrito = pago.montoTexto.trim() !== "";
  useEffect(() => onSucio(escrito), [escrito, onSucio]);

  return (
    <>
      <div className="flex flex-wrap items-end gap-3">
        <Campo id="cobro-monto" etiqueta="Monto">
          <Entrada
            inputMode="decimal"
            placeholder="0.00"
            value={pago.montoTexto}
            onChange={(e) => pago.setMontoTexto(e.target.value)}
            disabled={pago.enviando}
            className="w-36"
          />
        </Campo>
        <Campo id="cobro-metodo" etiqueta="Método">
          <Lista
            value={pago.metodo}
            onChange={(e) => pago.setMetodo(e.target.value as MetodoPagoCobro)}
            disabled={pago.enviando}
          >
            {METODOS_PAGO_COBRO.map((m) => (
              <option key={m.valor} value={m.valor}>
                {m.texto}
              </option>
            ))}
          </Lista>
        </Campo>
        <Campo id="cobro-cobrador" etiqueta="Cobró">
          <Lista
            value={pago.cobrador}
            onChange={(e) => pago.setCobrador(e.target.value)}
            disabled={pago.enviando}
            className="w-48"
          >
            <option value={REPARTIDOR_OFICINA}>Oficina</option>
            {pago.repartidores.map((r) => (
              <option key={r.id} value={r.id}>
                {r.nombre}
              </option>
            ))}
          </Lista>
        </Campo>
        <Campo id="cobro-fecha" etiqueta="Fecha">
          <Entrada
            type="date"
            min={pago.masVieja}
            max={pago.hoy}
            value={pago.fechaPago}
            onChange={(e) => pago.setFechaPago(e.target.value)}
            disabled={pago.enviando}
          />
        </Campo>
        {datos.saldoFavorCentavos > 0 && (
          <Button type="button" variant="outline" size="lg" onClick={onUsarSaldoFavor} disabled={pago.enviando}>
            {`Usar saldo a favor (${formatearPesos(datos.saldoFavorCentavos)})`}
          </Button>
        )}
      </div>
      <p className="text-sm text-muted-foreground">{`Las marcadas deben ${formatearPesos(pago.deben)}.`}</p>

      {escrito && problema && <Aviso tono="error">{problema}</Aviso>}
      {pago.plan && <VistaPreviaCobro plan={pago.plan} palomeadas={palomeadas} titulo="Así queda:" />}
      {valido && !pago.plan && pago.previsualizando && (
        <p className="text-sm text-muted-foreground">Calculando cómo queda…</p>
      )}
      {pago.error && <Aviso tono="error">{pago.error}</Aviso>}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="lg" onClick={onCancelar} disabled={pago.enviando}>
          Cancelar
        </Button>
        <Button type="button" size="lg" onClick={() => void pago.grabar()} disabled={pago.enviando || pago.plan === null}>
          {pago.enviando ? "Grabando…" : "Grabar pago"}
        </Button>
      </div>
    </>
  );
}

function FormaSaldoFavor({
  datos,
  palomeadas,
  onTerminado,
  onCancelar,
  onSucio,
  onVolver,
}: {
  datos: ClientePorCobrar;
  palomeadas: NotaPorCobrar[];
  onTerminado: (resultado: ResultadoCobro) => void;
  onCancelar: () => void;
  onSucio: (sucio: boolean) => void;
  onVolver: () => void;
}) {
  const saldo = useSaldoFavor({
    cliente: datos,
    palomeadas,
    onAplicado: (texto) => onTerminado({ texto, tono: "exito" }),
    onDesactualizado: (texto) => onTerminado({ texto, tono: "advertencia" }),
  });
  const problema = saldo.problema();
  const valido = problema === null;
  useVistaPreviaSola(saldo.clave, valido, saldo.revisar);
  // Elegir aplicar el saldo ya es un cobro a medio capturar.
  useEffect(() => onSucio(true), [onSucio]);

  return (
    <>
      <p className="text-sm text-muted-foreground">
        {`Tiene ${formatearPesos(datos.saldoFavorCentavos)} a favor; las marcadas deben ${formatearPesos(saldo.deben)}. No entra dinero: no lleva método ni cobrador.`}
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <Campo id="cobro-saldo-monto" etiqueta="Monto a aplicar">
          <Entrada
            inputMode="decimal"
            value={saldo.montoTexto}
            onChange={(e) => saldo.setMontoTexto(e.target.value)}
            disabled={saldo.enviando}
            className="w-36"
          />
        </Campo>
        <Button
          type="button"
          variant="link"
          className="font-semibold text-sucursal"
          onClick={onVolver}
          disabled={saldo.enviando}
        >
          Cobrar con dinero
        </Button>
      </div>

      {problema && <Aviso tono="error">{problema}</Aviso>}
      {saldo.plan && <VistaPreviaCobro plan={saldo.plan} palomeadas={palomeadas} titulo="Así queda:" />}
      {saldo.error && <Aviso tono="error">{saldo.error}</Aviso>}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="lg" onClick={onCancelar} disabled={saldo.enviando}>
          Cancelar
        </Button>
        <Button
          type="button"
          size="lg"
          onClick={() => void saldo.aplicar()}
          disabled={saldo.enviando || saldo.plan === null}
        >
          {saldo.enviando ? "Aplicando…" : "Aplicar saldo a favor"}
        </Button>
      </div>
    </>
  );
}
